import React, { useState, useEffect, useMemo, useRef, useLayoutEffect } from 'react';
import { Plus, Minus, Settings2, ArrowRight, ArrowLeft, CheckCircle2, Loader2, Download, Trash2, X, AlertTriangle, History, Save, Pencil, ChevronUp, ChevronDown, RefreshCw, Pen, Eraser, Anchor, ZoomIn, ZoomOut, Maximize, Undo2, Redo2, Type } from 'lucide-react';
import { TREATMENT_MENU } from './constants';
import { SelectedItem, TreatmentItem, SavedEstimate } from './types';
import { EstimatePreview } from './components/EstimatePreview';
import { DentalAnnotationData, EMPTY_ANNOTATION, ToolMode, PenColor, PenWidth, TEXT_FONT_DEFAULT, TEXT_FONT_STEP, clampTextFont } from './components/DentalChartCanvas';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

type AppMode = 'input' | 'preview';

const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>('input');
  const [isGenerating, setIsGenerating] = useState(false);
  
  // Date State
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear().toString());
  const [month, setMonth] = useState((today.getMonth() + 1).toString());
  const [day, setDay] = useState(today.getDate().toString());

  const [patientName, setPatientName] = useState('');
  const [doctorName, setDoctorName] = useState('');
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);

  // --- Menu Management State ---
  const [menuItems, setMenuItems] = useState<TreatmentItem[]>(() => {
    if (typeof window !== 'undefined') {
        // Changed to v4 to force reload of new defaults for existing users
        const saved = localStorage.getItem('dental_estimate_menu_v4');
        if (saved) {
            try {
                return JSON.parse(saved) as TreatmentItem[];
            } catch (e) {
                console.error("Failed to parse menu items", e);
                return TREATMENT_MENU;
            }
        }
    }
    return TREATMENT_MENU;
  });

  const [isMenuModalOpen, setIsMenuModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false); // For Reordering
  const [isClearModalOpen, setIsClearModalOpen] = useState(false); // For Clear Confirmation

  const [newItem, setNewItem] = useState({
    category: '',
    name: '',
    price: '',
    isNewCategory: false,
    newCategoryName: ''
  });

  // Delete Confirmation Modal State (Menu Items)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  // --- History State ---
  const [estimateHistory, setEstimateHistory] = useState<SavedEstimate[]>(() => {
    if (typeof window !== 'undefined') {
        const saved = localStorage.getItem('dental_estimate_history_v1');
        if (saved) {
            try {
                return JSON.parse(saved) as SavedEstimate[];
            } catch (e) {
                console.error("Failed to parse history", e);
                return [];
            }
        }
    }
    return [];
  });
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);

  // History Confirmation States
  const [historyToDeleteId, setHistoryToDeleteId] = useState<string | null>(null);
  const [historyToLoadRecord, setHistoryToLoadRecord] = useState<SavedEstimate | null>(null);

  // --- Dental Chart Hand-drawing / Stamp State (not persisted to history) ---
  const [annotation, setAnnotation] = useState<DentalAnnotationData>(EMPTY_ANNOTATION);
  const [toolMode, setToolMode] = useState<ToolMode>('pen');
  const [penColor, setPenColor] = useState<PenColor>('black');
  const [penWidth, setPenWidth] = useState<PenWidth>('medium');
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [textFontSize, setTextFontSize] = useState<number>(TEXT_FONT_DEFAULT);

  // Undo stack for annotations. Only "commit" changes (finished stroke, stamp
  // add/delete, clear) are recorded — continuous stamp dragging is not.
  const undoStackRef = useRef<DentalAnnotationData[]>([]);
  const redoStackRef = useRef<DentalAnnotationData[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const applyAnnotation = (next: DentalAnnotationData, kind: 'commit' | 'move' = 'commit') => {
    setAnnotation((prev) => {
      if (kind === 'commit') {
        undoStackRef.current.push(prev);
        redoStackRef.current = [];
        setCanUndo(true);
        setCanRedo(false);
      }
      return next;
    });
  };
  const undoAnnotation = () => {
    setAnnotation((prev) => {
      const stack = undoStackRef.current;
      if (stack.length === 0) return prev;
      redoStackRef.current.push(prev);
      const restored = stack.pop()!;
      setCanUndo(stack.length > 0);
      setCanRedo(true);
      return restored;
    });
  };
  const redoAnnotation = () => {
    setAnnotation((prev) => {
      const stack = redoStackRef.current;
      if (stack.length === 0) return prev;
      undoStackRef.current.push(prev);
      const restored = stack.pop()!;
      setCanRedo(stack.length > 0);
      setCanUndo(true);
      return restored;
    });
  };
  const clearAnnotation = () => {
    setAnnotation((prev) => {
      undoStackRef.current.push(prev);
      redoStackRef.current = [];
      setCanUndo(true);
      setCanRedo(false);
      return EMPTY_ANNOTATION;
    });
  };

  // Adjust the font size for new text boxes, and resize the currently selected one.
  const changeTextFontSize = (delta: number) => {
    const next = clampTextFont(textFontSize + delta);
    setTextFontSize(next);
    if (selectedTextId) {
      setAnnotation((ann) => ({
        ...ann,
        texts: ann.texts.map((t) => (t.id === selectedTextId ? { ...t, fontSize: next } : t)),
      }));
    }
  };

  // --- Preview Zoom / Pan State ---
  const ZOOM_MIN = 0.3;
  const ZOOM_MAX = 3;
  const A4_WIDTH_PX = 794; // 210mm at 96dpi
  const A4_HEIGHT_PX = 1123; // 297mm at 96dpi
  const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
  const [zoom, setZoom] = useState(1);
  const [pinchActive, setPinchActive] = useState(false);
  const zoomRef = useRef(1);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  const stageScrollRef = useRef<HTMLDivElement>(null);
  const sheetBoxRef = useRef<HTMLDivElement>(null);
  // Anchor point to keep fixed on screen across a zoom change (finger/cursor/center).
  const zoomAnchorRef = useRef<{ fx: number; fy: number; clientX: number; clientY: number } | null>(null);

  // Change zoom while keeping the given screen point pinned to the same spot on the sheet.
  const zoomToward = (nextZoom: number, clientX: number, clientY: number) => {
    const box = sheetBoxRef.current;
    if (box) {
      const r = box.getBoundingClientRect();
      zoomAnchorRef.current = {
        fx: (clientX - r.left) / r.width,
        fy: (clientY - r.top) / r.height,
        clientX,
        clientY,
      };
    }
    setZoom(clampZoom(nextZoom));
  };
  const zoomTowardCenter = (nextZoom: number) => {
    const el = stageScrollRef.current;
    if (!el) { setZoom(clampZoom(nextZoom)); return; }
    const r = el.getBoundingClientRect();
    zoomToward(nextZoom, r.left + r.width / 2, r.top + r.height / 2);
  };

  // After a zoom change, scroll so the anchored sheet point stays under the finger/cursor.
  useLayoutEffect(() => {
    const a = zoomAnchorRef.current;
    const el = stageScrollRef.current;
    const box = sheetBoxRef.current;
    if (!a || !el || !box) return;
    const r = box.getBoundingClientRect();
    const targetLeft = a.clientX - a.fx * r.width;
    const targetTop = a.clientY - a.fy * r.height;
    el.scrollLeft += r.left - targetLeft;
    el.scrollTop += r.top - targetTop;
    zoomAnchorRef.current = null;
  }, [zoom]);

  const fitZoom = () => {
    const el = stageScrollRef.current;
    if (!el) return;
    zoomAnchorRef.current = null;
    setZoom(clampZoom(Math.min(1, (el.clientWidth - 32) / A4_WIDTH_PX)));
  };

  // Fit the sheet to the available width whenever the preview screen opens.
  useEffect(() => {
    if (mode !== 'preview') return;
    fitZoom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Pinch / trackpad-pinch / ctrl+wheel zoom on the preview stage. Native listeners
  // (not React's) so we can preventDefault the browser's own page zoom. One-finger
  // touches fall through to native scrolling so the user can pan to any part of the sheet.
  useEffect(() => {
    const el = stageScrollRef.current;
    if (mode !== 'preview' || !el) return;

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return; // trackpad pinch and ctrl+wheel arrive as ctrl+wheel
      e.preventDefault();
      zoomToward(zoomRef.current * (1 - e.deltaY * 0.01), e.clientX, e.clientY);
    };

    let pinchStartDist = 0;
    let pinchStartZoom = 1;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const mid = (t: TouchList) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        pinchStartDist = dist(e.touches);
        pinchStartZoom = zoomRef.current;
        setPinchActive(true);
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchStartDist > 0) {
        e.preventDefault();
        const m = mid(e.touches);
        zoomToward(pinchStartZoom * (dist(e.touches) / pinchStartDist), m.x, m.y);
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        pinchStartDist = 0;
        setPinchActive(false);
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Save menu to LocalStorage
  useEffect(() => {
    localStorage.setItem('dental_estimate_menu_v4', JSON.stringify(menuItems));
  }, [menuItems]);

  // Save history to LocalStorage
  useEffect(() => {
    localStorage.setItem('dental_estimate_history_v1', JSON.stringify(estimateHistory));
  }, [estimateHistory]);

  // Derived state: Unique categories
  const categories = useMemo(() => {
    return Array.from(new Set(menuItems.map(i => i.category)));
  }, [menuItems]);

  // Derived state: Grouped menu
  const groupedMenu = useMemo(() => {
    // Preserve order from menuItems
    const groups: Record<string, TreatmentItem[]> = {};
    // Initialize groups in order of appearance
    menuItems.forEach(item => {
        if (!groups[item.category]) {
            groups[item.category] = [];
        }
        groups[item.category].push(item);
    });
    return groups;
  }, [menuItems]);

  // Handler: Add New Menu Item
  const handleAddMenu = () => {
    const categoryToUse = newItem.isNewCategory ? newItem.newCategoryName.trim() : newItem.category;
    const nameToUse = newItem.name.trim();
    const priceToUse = parseInt(newItem.price);

    if (!categoryToUse || !nameToUse || isNaN(priceToUse)) {
        alert('すべての項目を正しく入力してください。');
        return;
    }

    const newMenuItem: TreatmentItem = {
        id: `custom-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        name: nameToUse,
        price: priceToUse,
        category: categoryToUse
    };

    setMenuItems(prev => [...prev, newMenuItem]);
    setIsMenuModalOpen(false);
    setNewItem({ category: '', name: '', price: '', isNewCategory: false, newCategoryName: '' });
  };

  // Handler: Delete Menu Item
  const confirmDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setDeleteTargetId(id);
  };

  const executeDelete = () => {
    if (deleteTargetId) {
        setMenuItems(prev => prev.filter(item => item.id !== deleteTargetId));
        setSelectedItems(prev => prev.filter(item => item.id !== deleteTargetId));
        setDeleteTargetId(null);
    }
  };

  // Handler: Reorder Menu Items
  const moveItem = (id: string, direction: 'up' | 'down', e: React.MouseEvent) => {
    e.stopPropagation();
    
    // Find the item
    const currentItem = menuItems.find(i => i.id === id);
    if (!currentItem) return;

    // Get all items in the same category
    const categoryItems = menuItems.filter(i => i.category === currentItem.category);
    const indexInCat = categoryItems.findIndex(i => i.id === id);

    if (indexInCat === -1) return;

    let targetItem: TreatmentItem | undefined;

    if (direction === 'up') {
        if (indexInCat > 0) targetItem = categoryItems[indexInCat - 1];
    } else {
        if (indexInCat < categoryItems.length - 1) targetItem = categoryItems[indexInCat + 1];
    }

    if (targetItem) {
        // Find indices in the main array
        const idx1 = menuItems.findIndex(i => i.id === currentItem.id);
        const idx2 = menuItems.findIndex(i => i.id === targetItem.id);

        const newItems = [...menuItems];
        newItems[idx1] = targetItem;
        newItems[idx2] = currentItem;
        setMenuItems(newItems);
    }
  };

  // Handler: Trigger Clear Modal
  const handleClear = () => {
      setIsClearModalOpen(true);
  };

  // Handler: Execute Clear
  const executeClear = () => {
      setPatientName('');
      setDoctorName('');
      setSelectedItems([]);
      
      // Reset date to today
      const d = new Date();
      setYear(d.getFullYear().toString());
      setMonth((d.getMonth() + 1).toString());
      setDay(d.getDate().toString());

      setIsClearModalOpen(false);
  };

  // --- History Handlers ---
  const saveToHistory = () => {
      const total = selectedItems.reduce((acc, item) => acc + item.price * item.quantity, 0);
      const newEntry: SavedEstimate = {
          id: `hist-${Date.now()}`,
          timestamp: Date.now(),
          patientName,
          doctorName,
          date: `${year}年 ${month}月 ${day}日`,
          items: selectedItems,
          totalAmount: total
      };
      setEstimateHistory(prev => [newEntry, ...prev]);
      alert('履歴に保存しました');
  };

  // Trigger load confirmation
  const initiateLoadHistory = (record: SavedEstimate) => {
      setHistoryToLoadRecord(record);
  };

  // Execute load
  const executeLoadHistory = () => {
      if (!historyToLoadRecord) return;
      
      const record = historyToLoadRecord;
      setPatientName(record.patientName);
      setDoctorName(record.doctorName);
      
      // Parse date if format is "YYYY年 MM月 DD日"
      const dateMatch = record.date.match(/(\d+)年\s*(\d+)月\s*(\d+)日/);
      if (dateMatch) {
          setYear(dateMatch[1]);
          setMonth(dateMatch[2]);
          setDay(dateMatch[3]);
      }

      setSelectedItems(record.items);
      setMode('input');
      setIsHistoryModalOpen(false);
      setHistoryToLoadRecord(null); // Reset
  };

  // Trigger delete confirmation
  const initiateDeleteHistory = (id: string) => {
      setHistoryToDeleteId(id);
  };

  // Execute delete
  const executeDeleteHistory = () => {
      if (historyToDeleteId) {
          setEstimateHistory(prev => prev.filter(h => h.id !== historyToDeleteId));
          setHistoryToDeleteId(null);
      }
  };

  // --- PDF Generation ---
  const handleDownloadPDF = async () => {
    const input = document.getElementById('print-target-container');
    if (!input) return;

    try {
      setIsGenerating(true);
      const canvas = await html2canvas(input, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        width: 794,
        height: 1123,
        windowWidth: 794,
        windowHeight: 1123,
        onclone: (clonedDoc) => {
            const el = clonedDoc.getElementById('print-target-container');
            if (el) {
                el.style.display = 'block';
                el.style.position = 'static';
            }
        }
      });

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      pdf.addImage(imgData, 'PNG', 0, 0, 210, 297);
      const filename = patientName ? `${patientName}様_御見積書.pdf` : '御見積書.pdf';
      pdf.save(filename);

    } catch (error) {
      console.error("PDF Generation failed", error);
      alert("PDFの作成に失敗しました。");
    } finally {
      setIsGenerating(false);
    }
  };

  // List Item Actions
  const toggleItem = (item: TreatmentItem) => {
    if (isEditMode) return; // Disable toggling in edit mode
    const existing = selectedItems.find((i) => i.id === item.id);
    if (existing) {
      setSelectedItems((prev) => prev.filter((i) => i.id !== item.id));
    } else {
      setSelectedItems((prev) => [
        ...prev,
        { ...item, quantity: 1, site: '' },
      ]);
    }
  };

  const updateQuantity = (id: string, delta: number) => {
    setSelectedItems((prev) =>
      prev.map((item) => {
        if (item.id === id) {
          const newQ = Math.max(1, item.quantity + delta);
          return { ...item, quantity: newQ };
        }
        return item;
      })
    );
  };

  const setQuantity = (id: string, val: number) => {
    setSelectedItems((prev) =>
      prev.map((item) => {
        if (item.id === id) {
          return { ...item, quantity: Math.max(1, val) };
        }
        return item;
      })
    );
  };

  const updateSite = (id: string, site: string) => {
    setSelectedItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, site } : item))
    );
  };

  // New handler to update name temporarily for selected items
  const updateName = (id: string, newName: string) => {
    setSelectedItems((prev) =>
      prev.map((item) => {
        if (item.id === id) {
          return { ...item, name: newName };
        }
        return item;
      })
    );
  };

  // New handler to update price temporarily for selected items
  const updatePrice = (id: string, val: number) => {
    setSelectedItems((prev) =>
      prev.map((item) => {
        if (item.id === id) {
          return { ...item, price: val };
        }
        return item;
      })
    );
  };

  const isSelected = (id: string) => selectedItems.some((i) => i.id === id);
  const getSelectedItem = (id: string) => selectedItems.find((i) => i.id === id);

  const calculateTotal = () => {
    return selectedItems.reduce((acc, item) => acc + item.price * item.quantity, 0);
  };

  const formattedDate = `${year}年 ${month}月 ${day}日`;
  const previewData = {
    patientName,
    doctorName,
    date: formattedDate,
    items: selectedItems,
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans relative">
      
      {/* Hidden Print Container */}
      <div style={{ position: 'fixed', top: 0, left: '-9999px', zIndex: -1, width: '210mm', height: '297mm' }}>
        <div id="print-target-container">
             <EstimatePreview data={previewData} id="pdf-source" annotation={annotation} />
        </div>
      </div>

      {/* Render Input Screen */}
      {mode === 'input' && (
        <div className="pb-24">
          <div className="max-w-4xl mx-auto p-4 md:p-8">
            {/* Header Area */}
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-bold flex items-center gap-2 text-slate-800">
                    <Settings2 className="w-6 h-6 text-blue-600" />
                    お見積り作成
                </h1>
                <div className="flex gap-2">
                    <button
                        onClick={handleClear}
                        className="flex items-center gap-2 px-4 py-2 bg-white text-slate-700 font-bold rounded-lg border border-slate-300 shadow-sm hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors"
                    >
                        <Trash2 size={18} />
                        クリア
                    </button>
                    <button
                        onClick={() => setIsHistoryModalOpen(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-white text-slate-700 font-bold rounded-lg border border-slate-300 shadow-sm hover:bg-slate-50 transition-colors"
                    >
                        <History size={18} />
                        履歴を開く
                    </button>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="col-span-1 md:col-span-2">
                  <label className="block text-sm font-bold text-slate-600 mb-2">患者様名</label>
                  <input
                    type="text"
                    className="w-full bg-white text-black border border-slate-300 rounded-lg p-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                    value={patientName}
                    onChange={(e) => setPatientName(e.target.value)}
                  />
                </div>
                
                <div className="col-span-1 md:col-span-2">
                  <label className="block text-sm font-bold text-slate-600 mb-2">作成日</label>
                  <div className="flex items-center gap-2">
                      <div className="flex items-center">
                          <input type="text" className="w-20 bg-white text-black border border-slate-300 rounded-lg p-3 text-center focus:ring-2 focus:ring-blue-500 outline-none" value={year} onChange={(e) => setYear(e.target.value)} />
                          <span className="ml-2 font-bold text-slate-600">年</span>
                      </div>
                      <div className="flex items-center">
                          <input type="text" className="w-16 bg-white text-black border border-slate-300 rounded-lg p-3 text-center focus:ring-2 focus:ring-blue-500 outline-none" value={month} onChange={(e) => setMonth(e.target.value)} />
                          <span className="ml-2 font-bold text-slate-600">月</span>
                      </div>
                      <div className="flex items-center">
                          <input type="text" className="w-16 bg-white text-black border border-slate-300 rounded-lg p-3 text-center focus:ring-2 focus:ring-blue-500 outline-none" value={day} onChange={(e) => setDay(e.target.value)} />
                          <span className="ml-2 font-bold text-slate-600">日</span>
                      </div>
                  </div>
                </div>

                <div className="col-span-1 md:col-span-2">
                  <label className="block text-sm font-bold text-slate-600 mb-2">担当医</label>
                  <input
                    type="text"
                    className="w-full bg-white text-black border border-slate-300 rounded-lg p-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                    value={doctorName}
                    onChange={(e) => setDoctorName(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* Menu Selection Area */}
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <h2 className="text-lg font-bold text-slate-700 flex items-center gap-2">
                    <span className="bg-blue-600 text-white w-6 h-6 rounded-full flex items-center justify-center text-sm">2</span>
                    メニューを選択
                  </h2>
                  <div className="flex gap-2">
                      <button 
                        onClick={() => setIsEditMode(!isEditMode)}
                        className={`text-sm font-bold px-3 py-1.5 rounded-full transition-colors flex items-center gap-1 border ${isEditMode ? 'bg-orange-100 text-orange-700 border-orange-300' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
                      >
                        {isEditMode ? <CheckCircle2 size={16} /> : <Pencil size={16} />}
                        {isEditMode ? '編集を終了' : '並び替え・削除'}
                      </button>
                      <button 
                        onClick={() => setIsMenuModalOpen(true)}
                        className="text-sm font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-full transition-colors"
                      >
                        <Plus size={16} />
                        追加
                      </button>
                  </div>
              </div>
              
              {(Object.entries(groupedMenu) as [string, TreatmentItem[]][]).map(([category, items]) => (
                <div key={category} className={`bg-white rounded-xl shadow-sm border overflow-hidden ${isEditMode ? 'border-orange-200 ring-1 ring-orange-200' : 'border-slate-200'}`}>
                  <div className={`px-5 py-3 border-b ${isEditMode ? 'bg-orange-50 border-orange-100' : 'bg-slate-100 border-slate-200'}`}>
                    <h3 className={`font-bold ${isEditMode ? 'text-orange-800' : 'text-slate-700'}`}>{category}</h3>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {items.map((item, index) => {
                      const selected = isSelected(item.id);
                      const selectedData = getSelectedItem(item.id);

                      return (
                        <div
                          key={item.id}
                          className={`px-4 py-3 transition-all duration-200 group ${
                            selected && !isEditMode ? 'bg-blue-50' : 'hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            {/* Checkbox or Reorder Handles */}
                            <div className="flex-shrink-0 w-8 flex justify-center">
                              {isEditMode ? (
                                  <div className="flex flex-col gap-1">
                                      <button 
                                        onClick={(e) => moveItem(item.id, 'up', e)}
                                        className="text-slate-400 hover:text-orange-600 disabled:opacity-30 hover:bg-orange-100 rounded"
                                        disabled={index === 0}
                                      >
                                          <ChevronUp size={20} />
                                      </button>
                                      <button 
                                        onClick={(e) => moveItem(item.id, 'down', e)}
                                        className="text-slate-400 hover:text-orange-600 disabled:opacity-30 hover:bg-orange-100 rounded"
                                        disabled={index === items.length - 1}
                                      >
                                          <ChevronDown size={20} />
                                      </button>
                                  </div>
                              ) : (
                                  <input
                                    type="checkbox"
                                    id={`cb-${item.id}`}
                                    checked={selected}
                                    onChange={() => toggleItem(item)}
                                    className="w-5 h-5 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                                  />
                              )}
                            </div>
                            
                            {/* Main Row Content */}
                            <div className="flex-grow flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
                              <div className={`flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4 flex-grow ${isEditMode ? '' : 'cursor-pointer'}`} onClick={() => toggleItem(item)}>
                                {selected && selectedData && !isEditMode ? (
                                    <input 
                                        type="text"
                                        className="font-medium text-base text-slate-900 bg-white border border-slate-300 rounded px-2 py-1 flex-grow min-w-[120px] focus:ring-2 focus:ring-blue-500 outline-none"
                                        value={selectedData.name}
                                        onClick={(e) => e.stopPropagation()}
                                        onChange={(e) => updateName(item.id, e.target.value)}
                                    />
                                ) : (
                                  <label
                                    htmlFor={`cb-${item.id}`}
                                    className={`font-medium text-base cursor-pointer select-none ${isEditMode ? 'text-slate-500' : 'text-slate-900'}`}
                                  >
                                    {item.name}
                                  </label>
                                )}
                                
                                {/* Editable Price Logic */}
                                {selected && selectedData && !isEditMode ? (
                                  <div className="flex items-center text-slate-700 font-bold animate-fadeIn">
                                    <span className="text-sm mr-1">¥</span>
                                    <input
                                        type="number"
                                        className="w-24 bg-white border border-slate-300 rounded px-2 py-1 text-right font-nums focus:ring-2 focus:ring-blue-500 outline-none text-base"
                                        value={selectedData.price}
                                        onClick={(e) => e.stopPropagation()}
                                        onChange={(e) => updatePrice(item.id, parseInt(e.target.value) || 0)}
                                    />
                                  </div>
                                ) : (
                                  <div className="text-slate-500 text-sm font-bold">
                                    ¥{new Intl.NumberFormat('ja-JP').format(item.price)}
                                  </div>
                                )}
                              </div>

                              {/* Right Side: Controls or Delete Button */}
                              {selected && selectedData && !isEditMode ? (
                                <div className="flex items-center gap-3 animate-fadeIn mt-2 sm:mt-0 justify-end">
                                    <div className="flex items-center h-9 bg-white border border-slate-300 rounded-lg shadow-sm overflow-hidden">
                                        <button
                                          onClick={() => updateQuantity(item.id, -1)}
                                          className="w-8 h-full flex items-center justify-center hover:bg-slate-100 text-slate-600 border-r border-slate-300 transition-colors"
                                        >
                                          <Minus size={14} />
                                        </button>
                                        <input 
                                            type="number" 
                                            className="w-10 text-center h-full outline-none text-sm font-bold text-slate-700 bg-transparent"
                                            value={selectedData.quantity}
                                            onChange={(e) => setQuantity(item.id, parseInt(e.target.value) || 1)}
                                        />
                                        <button
                                          onClick={() => updateQuantity(item.id, 1)}
                                          className="w-8 h-full flex items-center justify-center hover:bg-slate-100 text-slate-600 border-l border-slate-300 transition-colors"
                                        >
                                          <Plus size={14} />
                                        </button>
                                    </div>

                                    <input
                                      type="text"
                                      placeholder="部位・備考"
                                      value={selectedData.site}
                                      onChange={(e) => updateSite(item.id, e.target.value)}
                                      className="w-32 sm:w-48 h-9 bg-white border border-slate-300 rounded-lg px-3 py-1 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none shadow-sm transition-all"
                                    />
                                </div>
                              ) : null}
                              
                              {isEditMode && (
                                <div className="flex items-center justify-end sm:min-h-[36px]">
                                   <button
                                     type="button"
                                     onClick={(e) => confirmDelete(item.id, e)}
                                     className="p-2 text-red-500 bg-red-50 rounded-full hover:bg-red-100 transition-colors z-10"
                                     title="この項目をメニューから削除"
                                   >
                                     <Trash2 size={18} />
                                   </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ADD MENU MODAL */}
          {isMenuModalOpen && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
               <div className="bg-white rounded-xl shadow-xl max-w-md w-full overflow-hidden animate-fadeIn">
                  <div className="flex justify-between items-center p-4 border-b border-slate-100">
                      <h3 className="font-bold text-lg text-slate-800">新規メニュー登録</h3>
                      <button onClick={() => setIsMenuModalOpen(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100"><X size={20} /></button>
                  </div>
                  
                  <div className="p-6 space-y-4">
                      {/* Category Selection Logic */}
                      <div>
                          <label className="block text-sm font-bold text-slate-600 mb-2">カテゴリ</label>
                          <div className="flex flex-col gap-2">
                              <label className="flex items-center gap-2 cursor-pointer">
                                  <input type="radio" name="catType" checked={!newItem.isNewCategory} onChange={() => setNewItem({...newItem, isNewCategory: false})} className="text-blue-600 focus:ring-blue-500" />
                                  <span className="text-sm">既存カテゴリから選択</span>
                              </label>
                              <select disabled={newItem.isNewCategory} value={newItem.category} onChange={(e) => setNewItem({...newItem, category: e.target.value})} className="w-full bg-white border border-slate-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all disabled:bg-slate-100 disabled:text-slate-400">
                                  <option value="">カテゴリを選択...</option>
                                  {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                              </select>

                              <label className="flex items-center gap-2 cursor-pointer mt-2">
                                  <input type="radio" name="catType" checked={newItem.isNewCategory} onChange={() => setNewItem({...newItem, isNewCategory: true})} className="text-blue-600 focus:ring-blue-500" />
                                  <span className="text-sm">新しいカテゴリを作成</span>
                              </label>
                              <input type="text" placeholder="例：予防歯科" disabled={!newItem.isNewCategory} value={newItem.newCategoryName} onChange={(e) => setNewItem({...newItem, newCategoryName: e.target.value})} className="w-full bg-white border border-slate-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all disabled:bg-slate-100 disabled:text-slate-400" />
                          </div>
                      </div>

                      <div>
                          <label className="block text-sm font-bold text-slate-600 mb-2">メニュー名</label>
                          <input type="text" value={newItem.name} onChange={(e) => setNewItem({...newItem, name: e.target.value})} className="w-full bg-white border border-slate-300 rounded-lg p-3 focus:ring-2 focus:ring-blue-500 outline-none transition-all" />
                      </div>

                      <div>
                          <label className="block text-sm font-bold text-slate-600 mb-2">金額 (税込)</label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">¥</span>
                            <input type="number" value={newItem.price} onChange={(e) => setNewItem({...newItem, price: e.target.value})} className="w-full bg-white border border-slate-300 rounded-lg p-3 pl-8 font-nums focus:ring-2 focus:ring-blue-500 outline-none transition-all" />
                          </div>
                      </div>
                  </div>

                  <div className="p-4 bg-slate-50 flex justify-end gap-3">
                      <button onClick={() => setIsMenuModalOpen(false)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-200 rounded-lg">キャンセル</button>
                      <button onClick={handleAddMenu} className="px-4 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm">追加する</button>
                  </div>
               </div>
            </div>
          )}

          {/* HISTORY MODAL */}
          {isHistoryModalOpen && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col animate-fadeIn">
                 <div className="flex justify-between items-center p-4 border-b border-slate-100">
                      <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                          <History className="text-blue-600" />
                          保存済み履歴
                      </h3>
                      <button onClick={() => setIsHistoryModalOpen(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100"><X size={20} /></button>
                 </div>
                 <div className="flex-1 overflow-auto p-4 space-y-3 bg-slate-50">
                    {(estimateHistory as SavedEstimate[]).length === 0 ? (
                        <div className="text-center py-10 text-slate-400">履歴はありません</div>
                    ) : (
                        (estimateHistory as SavedEstimate[]).map((record) => (
                            <div key={record.id} className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="font-bold text-lg text-slate-800">{record.patientName || '名称未設定'}</span>
                                        <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{record.date}</span>
                                    </div>
                                    <div className="text-sm text-slate-500">
                                        合計: <span className="font-bold text-slate-700">¥{new Intl.NumberFormat('ja-JP').format(record.totalAmount)}</span>
                                        <span className="mx-2">|</span>
                                        項目数: {record.items.length}
                                    </div>
                                </div>
                                <div className="flex gap-2 justify-end">
                                    <button 
                                      onClick={() => initiateLoadHistory(record)}
                                      className="px-3 py-1.5 text-sm font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg border border-blue-200 transition-colors flex items-center gap-1"
                                    >
                                        <RefreshCw size={16} />
                                        読み込む
                                    </button>
                                    <button 
                                      onClick={() => initiateDeleteHistory(record.id)}
                                      className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                 </div>
              </div>
            </div>
          )}

          {/* CLEAR CONFIRMATION MODAL */}
          {isClearModalOpen && (
            <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
              <div className="bg-white rounded-xl shadow-xl max-w-sm w-full overflow-hidden animate-fadeIn">
                 <div className="p-6 text-center">
                    <div className="w-12 h-12 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Trash2 size={24} />
                    </div>
                    <h3 className="text-lg font-bold text-slate-800 mb-2">入力内容のリセット</h3>
                    <p className="text-slate-600 text-sm">
                        現在入力中の内容を全て消去しますか？<br/>
                        (患者名・担当医・選択項目)
                    </p>
                 </div>
                 <div className="flex border-t border-slate-100">
                    <button onClick={() => setIsClearModalOpen(false)} className="flex-1 py-3 text-slate-600 font-bold hover:bg-slate-50 transition-colors border-r border-slate-100">キャンセル</button>
                    <button onClick={executeClear} className="flex-1 py-3 text-red-600 font-bold hover:bg-red-50 transition-colors">リセットする</button>
                 </div>
              </div>
            </div>
          )}

          {/* DELETE CONFIRMATION MODAL (MENU) */}
          {deleteTargetId && (
            <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
              <div className="bg-white rounded-xl shadow-xl max-w-sm w-full overflow-hidden animate-fadeIn">
                 <div className="p-6 text-center">
                    <div className="w-12 h-12 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                        <AlertTriangle size={24} />
                    </div>
                    <h3 className="text-lg font-bold text-slate-800 mb-2">メニューの削除</h3>
                    <p className="text-slate-600 text-sm">削除してよろしいですか？<br/>(元に戻せません)</p>
                 </div>
                 <div className="flex border-t border-slate-100">
                    <button onClick={() => setDeleteTargetId(null)} className="flex-1 py-3 text-slate-600 font-bold hover:bg-slate-50 transition-colors border-r border-slate-100">キャンセル</button>
                    <button onClick={executeDelete} className="flex-1 py-3 text-red-600 font-bold hover:bg-red-50 transition-colors">削除する</button>
                 </div>
              </div>
            </div>
          )}

          {/* DELETE CONFIRMATION MODAL (HISTORY) */}
          {historyToDeleteId && (
            <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
              <div className="bg-white rounded-xl shadow-xl max-w-sm w-full overflow-hidden animate-fadeIn">
                 <div className="p-6 text-center">
                    <div className="w-12 h-12 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Trash2 size={24} />
                    </div>
                    <h3 className="text-lg font-bold text-slate-800 mb-2">履歴の削除</h3>
                    <p className="text-slate-600 text-sm">この履歴を削除しますか？</p>
                 </div>
                 <div className="flex border-t border-slate-100">
                    <button onClick={() => setHistoryToDeleteId(null)} className="flex-1 py-3 text-slate-600 font-bold hover:bg-slate-50 transition-colors border-r border-slate-100">キャンセル</button>
                    <button onClick={executeDeleteHistory} className="flex-1 py-3 text-red-600 font-bold hover:bg-red-50 transition-colors">削除する</button>
                 </div>
              </div>
            </div>
          )}

          {/* LOAD CONFIRMATION MODAL (HISTORY) */}
          {historyToLoadRecord && (
            <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
              <div className="bg-white rounded-xl shadow-xl max-w-sm w-full overflow-hidden animate-fadeIn">
                 <div className="p-6 text-center">
                    <div className="w-12 h-12 bg-blue-100 text-blue-500 rounded-full flex items-center justify-center mx-auto mb-4">
                        <RefreshCw size={24} />
                    </div>
                    <h3 className="text-lg font-bold text-slate-800 mb-2">履歴の読み込み</h3>
                    <p className="text-slate-600 text-sm">
                        履歴を読み込みますか？<br/>
                        <span className="text-red-500 text-xs">※現在入力中の内容は破棄されます</span>
                    </p>
                 </div>
                 <div className="flex border-t border-slate-100">
                    <button onClick={() => setHistoryToLoadRecord(null)} className="flex-1 py-3 text-slate-600 font-bold hover:bg-slate-50 transition-colors border-r border-slate-100">キャンセル</button>
                    <button onClick={executeLoadHistory} className="flex-1 py-3 text-blue-600 font-bold hover:bg-blue-50 transition-colors">読み込む</button>
                 </div>
              </div>
            </div>
          )}

          {/* Footer with Preview Button */}
          <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 p-4 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] z-40">
            <div className="max-w-4xl mx-auto flex justify-between items-center">
                <div className="flex flex-col">
                    <span className="text-xs font-bold text-slate-500">合計見積額 (税込)</span>
                    <span className="text-2xl font-bold text-slate-800 font-nums">
                        ¥{new Intl.NumberFormat('ja-JP').format(calculateTotal())}
                    </span>
                </div>
                <button
                    onClick={() => setMode('preview')}
                    disabled={selectedItems.length === 0}
                    className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-white transition-all shadow-md ${
                        selectedItems.length === 0 
                        ? 'bg-slate-300 cursor-not-allowed' 
                        : 'bg-blue-600 hover:bg-blue-700 hover:shadow-lg hover:-translate-y-0.5'
                    }`}
                >
                    プレビューへ
                    <ArrowRight size={20} />
                </button>
            </div>
          </div>
        </div>
      )}

      {/* Render Preview Screen */}
      {mode === 'preview' && (
        // Fixed viewport height so the header and bottom toolbar stay pinned and only
        // the sheet area (below) scrolls/zooms. 100dvh tracks the iPad Safari toolbar.
        // select-none across the whole screen so stylus drawing never turns into a
        // text-selection gesture on the toolbar labels/buttons.
        <div
          className="h-[100dvh] flex flex-col bg-slate-500 select-none"
          style={{ WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
        >
            <div className="bg-white p-4 shadow-md z-10 border-b border-gray-200">
                <div className="max-w-5xl mx-auto flex items-center justify-between">
                    <h2 className="font-bold flex items-center gap-2 text-slate-800">
                        <CheckCircle2 className="text-green-600" />
                        プレビュー確認
                    </h2>
                </div>
            </div>

            <div ref={stageScrollRef} className="flex-1 min-h-0 overflow-auto p-4 md:p-8 bg-slate-500">
                {/* Sized box reserves the scaled footprint so scrolling/centering are correct;
                    the inner div does the visual scale from its top-left corner. */}
                <div
                    ref={sheetBoxRef}
                    className="mb-20 shadow-2xl"
                    style={{ width: A4_WIDTH_PX * zoom, height: A4_HEIGHT_PX * zoom, margin: '0 auto' }}
                >
                    <div
                        style={{
                            width: A4_WIDTH_PX,
                            height: A4_HEIGHT_PX,
                            transform: `scale(${zoom})`,
                            transformOrigin: '0 0',
                        }}
                    >
                        <EstimatePreview
                            data={previewData}
                            annotation={annotation}
                            onAnnotationChange={applyAnnotation}
                            interactive
                            toolMode={toolMode}
                            penColor={penColor}
                            penWidth={penWidth}
                            zoom={zoom}
                            pinchActive={pinchActive}
                            textFontSize={textFontSize}
                            selectedTextId={selectedTextId}
                            onSelectTextId={setSelectedTextId}
                        />
                    </div>
                </div>
            </div>

            <div className="bg-white border-t border-slate-200 p-4 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] z-20">
                {/* Dental Chart Drawing Toolbar — placed directly below the chart/preview */}
                <div className="max-w-5xl mx-auto flex flex-wrap items-center gap-2 pb-3 mb-3 border-b border-slate-100">
                    <span className="text-xs font-bold text-slate-500 mr-1">歯式メモ:</span>

                    <button
                        onClick={() => setToolMode('stamp-upper')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                            toolMode === 'stamp-upper'
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-white text-blue-600 border-blue-300 hover:bg-blue-50'
                        }`}
                    >
                        <Anchor size={14} className="rotate-180" />
                        インプラント(上顎用)
                    </button>

                    <button
                        onClick={() => setToolMode('stamp-lower')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                            toolMode === 'stamp-lower'
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-white text-blue-600 border-blue-300 hover:bg-blue-50'
                        }`}
                    >
                        <Anchor size={14} />
                        インプラント(下顎用)
                    </button>

                    <button
                        onClick={() => setToolMode('text')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                            toolMode === 'text'
                                ? 'bg-slate-800 text-white border-slate-800'
                                : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                        }`}
                    >
                        <Type size={14} />
                        テキスト
                    </button>

                    <div className="w-px h-5 bg-slate-200 mx-1" />

                    {/* Text font size (smaller / larger) */}
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => changeTextFontSize(-TEXT_FONT_STEP)}
                            className="w-7 h-7 flex items-center justify-center rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 transition-colors font-bold"
                            aria-label="文字を小さく"
                        >
                            <span className="text-[11px] leading-none">A</span>
                        </button>
                        <button
                            onClick={() => changeTextFontSize(TEXT_FONT_STEP)}
                            className="w-7 h-7 flex items-center justify-center rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 transition-colors font-bold"
                            aria-label="文字を大きく"
                        >
                            <span className="text-[15px] leading-none">A</span>
                        </button>
                    </div>

                    <div className="w-px h-5 bg-slate-200 mx-1" />

                    <button
                        onClick={undoAnnotation}
                        disabled={!canUndo}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                            canUndo
                                ? 'border-slate-300 text-slate-600 hover:bg-slate-50'
                                : 'border-slate-200 text-slate-300 cursor-not-allowed'
                        }`}
                    >
                        <Undo2 size={14} />
                        一つ戻る
                    </button>

                    <button
                        onClick={redoAnnotation}
                        disabled={!canRedo}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                            canRedo
                                ? 'border-slate-300 text-slate-600 hover:bg-slate-50'
                                : 'border-slate-200 text-slate-300 cursor-not-allowed'
                        }`}
                    >
                        <Redo2 size={14} />
                        一つ進む
                    </button>

                    <button
                        onClick={clearAnnotation}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-300 text-slate-500 hover:bg-slate-50 transition-colors"
                    >
                        <Trash2 size={14} />
                        全消去
                    </button>

                    {/* Zoom controls (pinch / trackpad-pinch also work directly on the sheet) */}
                    <div className="flex items-center gap-1 ml-auto">
                        <button
                            onClick={() => zoomTowardCenter(zoomRef.current - 0.1)}
                            className="p-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 transition-colors"
                            aria-label="縮小"
                        >
                            <ZoomOut size={14} />
                        </button>
                        <span className="text-xs font-bold text-slate-500 w-12 text-center tabular-nums">
                            {Math.round(zoom * 100)}%
                        </span>
                        <button
                            onClick={() => zoomTowardCenter(zoomRef.current + 0.1)}
                            className="p-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 transition-colors"
                            aria-label="拡大"
                        >
                            <ZoomIn size={14} />
                        </button>
                        <button
                            onClick={fitZoom}
                            className="p-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 transition-colors"
                            aria-label="全体表示"
                        >
                            <Maximize size={14} />
                        </button>
                    </div>

                    {/* Line break: pen tools go on their own row */}
                    <div className="basis-full h-0" />

                    <button
                        onClick={() => { setToolMode('pen'); setPenColor('black'); }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                            toolMode === 'pen' && penColor === 'black'
                                ? 'bg-slate-800 text-white border-slate-800'
                                : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                        }`}
                    >
                        <Pen size={14} />
                        黒ペン
                    </button>

                    <button
                        onClick={() => { setToolMode('pen'); setPenColor('red'); }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                            toolMode === 'pen' && penColor === 'red'
                                ? 'bg-red-600 text-white border-red-600'
                                : 'bg-white text-red-600 border-red-300 hover:bg-red-50'
                        }`}
                    >
                        <Pen size={14} />
                        赤ペン
                    </button>

                    <button
                        onClick={() => setToolMode('eraser')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                            toolMode === 'eraser'
                                ? 'bg-slate-800 text-white border-slate-800'
                                : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                        }`}
                    >
                        <Eraser size={14} />
                        消しゴム
                    </button>

                    <div className="w-px h-5 bg-slate-200 mx-1" />

                    {([
                        { value: 'thin', label: '細', dot: 3 },
                        { value: 'medium', label: '中', dot: 5 },
                        { value: 'thick', label: '太', dot: 8 },
                    ] as { value: PenWidth; label: string; dot: number }[]).map((w) => (
                        <button
                            key={w.value}
                            onClick={() => setPenWidth(w.value)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                                penWidth === w.value
                                    ? 'bg-slate-800 text-white border-slate-800'
                                    : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                            }`}
                        >
                            <span
                                className={`inline-block rounded-full ${penWidth === w.value ? 'bg-white' : 'bg-slate-600'}`}
                                style={{ width: w.dot, height: w.dot }}
                            />
                            {w.label}
                        </button>
                    ))}
                </div>

                <div className="max-w-5xl mx-auto flex gap-4">
                    <button
                        onClick={() => setMode('input')}
                        className="flex-1 md:flex-none md:w-32 py-3 px-4 rounded-lg border-2 border-slate-300 font-bold text-slate-600 hover:bg-slate-50 transition-colors flex items-center justify-center gap-2"
                    >
                        <ArrowLeft size={20} />
                        戻る
                    </button>
                    
                    <button
                        onClick={saveToHistory}
                        className="flex-1 md:flex-none md:w-48 py-3 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold transition-colors flex items-center justify-center gap-2 shadow-md"
                    >
                        <Save size={20} />
                        履歴に保存
                    </button>

                    <div className="flex-1">
                        <button
                            onClick={handleDownloadPDF}
                            disabled={isGenerating}
                            className={`w-full h-full py-3 px-6 rounded-lg font-bold text-white shadow-lg transition-all flex items-center justify-center gap-2 ${
                              isGenerating 
                                ? 'bg-blue-400 cursor-wait' 
                                : 'bg-blue-600 hover:bg-blue-700 hover:shadow-xl'
                            }`}
                        >
                            {isGenerating ? <Loader2 className="animate-spin" size={20} /> : <Download size={20} />}
                            {isGenerating ? '作成中...' : 'PDFダウンロード'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

export default App;