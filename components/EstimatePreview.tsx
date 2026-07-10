import React from 'react';
import { EstimateData } from '../types';
import {
  DentalChartCanvas,
  DentalAnnotationData,
  EMPTY_ANNOTATION,
  ToolMode,
  PenColor,
  PenWidth,
} from './DentalChartCanvas';

interface EstimatePreviewProps {
  data: EstimateData;
  id?: string; // Optional ID for PDF capture targeting
  annotation?: DentalAnnotationData;
  onAnnotationChange?: (data: DentalAnnotationData) => void;
  interactive?: boolean;
  toolMode?: ToolMode;
  penColor?: PenColor;
  penWidth?: PenWidth;
  zoom?: number;
  pinchActive?: boolean;
}

export const EstimatePreview: React.FC<EstimatePreviewProps> = ({
  data,
  id,
  annotation = EMPTY_ANNOTATION,
  onAnnotationChange,
  interactive = false,
  toolMode,
  penColor,
  penWidth,
  zoom,
  pinchActive,
}) => {
    const calculateTotal = () => {
      return data.items.reduce((acc, item) => acc + item.price * item.quantity, 0);
    };

    const total = calculateTotal();
    const formattedTotal = new Intl.NumberFormat('ja-JP').format(total);

    return (
      // Container setup
      <div className="w-full flex justify-center font-serif text-slate-900">
        <div
          id={id}
          className="bg-white relative flex flex-col justify-between"
          style={{
            width: '210mm',
            height: '297mm', // Fixed A4 height
            padding: '24mm',
            boxSizing: 'border-box',
          }}
        >
          {/* Header Section */}
          <header className="mb-8">
            {/* Title */}
            <h1 className="text-3xl font-serif text-center font-medium tracking-[0.5em] mb-16 text-black mt-4 border-b pb-2 border-transparent">
              自費診療お見積り書
            </h1>

            {/* Info Grid */}
            <div className="flex flex-col gap-6">
               <div className="flex justify-between items-end">
                  {/* Left Side: Patient Name */}
                  <div className="flex items-end w-[40%]">
                    <span className="text-base text-black whitespace-nowrap mb-1 font-serif tracking-widest">患者名:</span>
                    <div className="flex-grow px-2 mx-2">
                        {/* Right aligned near Sama */}
                        <span className="text-2xl text-black leading-none block pb-1 text-right font-serif tracking-widest">
                            {data.patientName || '　　　　　'}
                        </span>
                    </div>
                    <span className="text-base text-black whitespace-nowrap mb-1 font-serif">様</span>
                  </div>

                  {/* Right Side: Date */}
                  <div className="flex items-end w-[35%] justify-end">
                    <span className="text-sm text-black whitespace-nowrap mb-1 font-serif tracking-widest">作成日:</span>
                    <div className="w-auto min-w-[120px] px-2 mx-2">
                        <span className="text-lg text-black font-nums leading-none block pb-1 text-right">
                            {data.date}
                        </span>
                    </div>
                  </div>
               </div>

               <div className="flex justify-between items-end">
                  <div className="w-[40%]"></div> {/* Spacer */}

                  <div className="flex items-end w-[35%] justify-end">
                    <span className="text-sm text-black whitespace-nowrap mb-1 font-serif tracking-widest">担当医:</span>
                    <div className="w-auto min-w-[120px] px-2 mx-2">
                        <span className="text-lg text-black font-serif leading-none block pb-1 text-right tracking-widest">
                             {data.doctorName || '　　　　　'}
                        </span>
                    </div>
                  </div>
               </div>
            </div>
          </header>

          {/* Main Content */}
          <main className="flex-grow">
            
            {/* Total Amount Section */}
            <div className="mb-6 mt-4 flex justify-end">
                <div className="flex items-end border-b-2 border-black pb-3 w-auto min-w-[50%] justify-between px-4">
                    <div className="flex items-center mb-1">
                        <span className="text-base font-serif text-black tracking-widest">御見積金額</span>
                        <span className="text-xs font-serif text-black ml-2 pt-0.5">(税込)</span>
                    </div>
                    <div className="flex items-baseline mb-1">
                        <span className="text-lg font-serif text-black leading-none mr-2">￥</span>
                        <span className="text-2xl font-medium font-nums tracking-widest text-black leading-none mr-2">
                            {formattedTotal}
                        </span>
                        <span className="text-base font-serif text-black leading-none">-</span>
                    </div>
                </div>
            </div>

            {/* Table - Compact Grid Style */}
            <div className="w-full mb-6">
                <table className="w-full border-collapse border border-black text-xs font-serif">
                <thead>
                    <tr className="bg-slate-100">
                        <th className="border border-black py-2 px-2 w-[45%] text-center font-medium text-black text-xs tracking-widest">
                            内　容
                        </th>
                        <th className="border border-black py-2 px-2 w-[15%] text-center font-medium text-black text-xs tracking-widest">
                            単　価
                        </th>
                        <th className="border border-black py-2 px-2 w-[10%] text-center font-medium text-black text-xs tracking-widest">
                            数　量
                        </th>
                        <th className="border border-black py-2 px-2 w-[15%] text-center font-medium text-black text-xs tracking-widest">
                            金　額
                        </th>
                        <th className="border border-black py-2 px-2 w-[15%] text-center font-medium text-black text-xs tracking-widest">
                            備　考
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {data.items.length === 0 ? (
                    // Empty rows for layout stability
                    Array.from({ length: 15 }).map((_, i) => (
                        <tr key={i}>
                            <td className="border border-black py-1 px-2 h-8"></td>
                            <td className="border border-black py-1 px-2"></td>
                            <td className="border border-black py-1 px-2"></td>
                            <td className="border border-black py-1 px-2"></td>
                            <td className="border border-black py-1 px-2"></td>
                        </tr>
                    ))
                    ) : (
                        <>
                            {data.items.map((item) => (
                                <tr key={item.id}>
                                    <td className="border border-black py-2 px-2 pl-3 text-left text-black text-xs align-middle tracking-wide">
                                        {item.name}
                                    </td>
                                    <td className="border border-black py-2 px-2 text-right text-black font-nums text-sm align-middle">
                                        ¥{new Intl.NumberFormat('ja-JP').format(item.price)}
                                    </td>
                                    <td className="border border-black py-2 px-2 text-center text-black font-nums text-sm align-middle">
                                        {item.quantity}
                                    </td>
                                    <td className="border border-black py-2 px-2 text-right font-medium text-black font-nums text-sm align-middle">
                                        ¥{new Intl.NumberFormat('ja-JP').format(item.price * item.quantity)}
                                    </td>
                                    <td className="border border-black py-2 px-2 text-center text-[10px] text-black align-middle font-nums">
                                        {item.site}
                                    </td>
                                </tr>
                            ))}
                        </>
                    )}
                    
                    {/* Total Row in Table */}
                    <tr className="bg-slate-50 font-bold">
                        <td
                            colSpan={3}
                            className="border border-black py-2 px-4 text-right pr-6 text-black text-sm tracking-widest"
                        >
                            合　計
                        </td>
                        <td className="border border-black py-2 px-2 text-right text-black font-nums text-base">
                            ¥{formattedTotal}
                        </td>
                        <td className="border border-black py-2 px-2 bg-slate-100"></td>
                    </tr>
                </tbody>
                </table>
            </div>

            {/* Note Box */}
            <div className="w-full mt-4">
               <div className="border-b border-black w-16 mb-1"></div>
               <p className="text-xs text-black tracking-widest mb-1">【備考】</p>
               <div className="w-full border border-black p-2 text-sm rounded-none">
                   <DentalChartCanvas
                     data={annotation}
                     onChange={onAnnotationChange}
                     interactive={interactive}
                     toolMode={toolMode}
                     penColor={penColor}
                     penWidth={penWidth}
                     zoom={zoom}
                     pinchActive={pinchActive}
                   />
               </div>
            </div>
          </main>

          {/* Footer */}
          <footer className="mt-4 h-8">
             {/* Empty footer */}
          </footer>
        </div>
      </div>
    );
};