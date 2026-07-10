import { TreatmentItem } from './types';

/**
 * TREATMENT_MENU
 * Add or remove items here to update the application menu.
 * Categories help organize the UI.
 */
export const TREATMENT_MENU: TreatmentItem[] = [
  // インプラント
  { id: 'imp-1', name: 'インプラント一次手術', price: 275000, category: 'インプラント' },
  { id: 'imp-2', name: 'インプラント上部構造', price: 165000, category: 'インプラント' },
  { id: 'imp-3', name: 'インプラント10年保証', price: 33000, category: 'インプラント' },
  { id: 'imp-4', name: 'サージカルガイド', price: 22000, category: 'インプラント' },
  { id: 'imp-5', name: '抜歯即時埋入', price: 22000, category: 'インプラント' },
  { id: 'imp-6', name: '即時プロビジョナリゼーション(仮歯)', price: 44000, category: 'インプラント' },
  { id: 'imp-7', name: '骨造成(GBR)', price: 55000, category: 'インプラント' },
  { id: 'imp-8', name: 'インプラント用の入れ歯', price: 385000, category: 'インプラント' },
  { id: 'imp-9', name: 'ロケーターアタッチメント', price: 77000, category: 'インプラント' },

  // つめ物・かぶせ物
  { id: 'crn-1', name: 'セラミックインレー', price: 88000, category: 'つめ物・かぶせ物' },
  { id: 'crn-2', name: 'セラミッククラウン臼歯', price: 132000, category: 'つめ物・かぶせ物' },
  { id: 'crn-3', name: 'セラミッククラウン前歯', price: 154000, category: 'つめ物・かぶせ物' },
  { id: 'crn-4', name: 'ゴールドインレー', price: 88000, category: 'つめ物・かぶせ物' },
  { id: 'crn-5', name: 'ゴールドアンレー', price: 110000, category: 'つめ物・かぶせ物' },
  { id: 'crn-6', name: 'ゴールドクラウン', price: 154000, category: 'つめ物・かぶせ物' },
  { id: 'crn-7', name: 'ラミネートベニア', price: 132000, category: 'つめ物・かぶせ物' },

  // 入れ歯
  { id: 'den-1', name: '総入れ歯(チタン)', price: 495000, category: '入れ歯' },
  { id: 'den-2', name: '総入れ歯(コバルト)', price: 440000, category: '入れ歯' },
  { id: 'den-3', name: 'ノンクラスプデンチャー', price: 121000, category: '入れ歯' },

  // 矯正
  { id: 'ort-1', name: '小児床矯正', price: 440000, category: '矯正' },
  { id: 'ort-2', name: '小児二期治療', price: 440000, category: '矯正' },
  { id: 'ort-3', name: '小児マウスピース矯正(インビザラインファースト)', price: 550000, category: '矯正' },
  { id: 'ort-4', name: 'プレオルソ', price: 88000, category: '矯正' },
  { id: 'ort-5', name: 'プレオルソ(2個目以降)', price: 11000, category: '矯正' },
  { id: 'ort-6', name: 'マウスピース矯正(インビザライン・フル)', price: 880000, category: '矯正' },
  { id: 'ort-7', name: 'マウスピース型部分矯正(インビザライン)', price: 550000, category: '矯正' },
  { id: 'ort-8', name: 'ワイヤー矯正', price: 990000, category: '矯正' },
  { id: 'ort-9', name: 'MTM(部分矯正)', price: 110000, category: '矯正' },
  { id: 'ort-10', name: '小児矯正 精密検査', price: 33000, category: '矯正' },
  { id: 'ort-11', name: '成人矯正 精密検査', price: 55000, category: '矯正' },
  { id: 'ort-12', name: '便宜抜歯', price: 11000, category: '矯正' },

  // ホワイトニング
  { id: 'wht-1', name: 'オフィスホワイトニング', price: 44000, category: 'ホワイトニング' },
  { id: 'wht-2', name: 'ホームホワイトニング', price: 33000, category: 'ホワイトニング' },
  { id: 'wht-3', name: 'デュアルホワイトニング', price: 66000, category: 'ホワイトニング' },

  // フリー
  { id: 'free-1', name: 'フリー', price: 0, category: 'フリー' },
  { id: 'free-2', name: 'フリー', price: 0, category: 'フリー' },
  { id: 'free-3', name: 'フリー', price: 0, category: 'フリー' },

  // 値引き
  { id: 'dsc-1', name: '値引き', price: -10000, category: '値引き' },
];

// Helper to get today's date in YYYY/MM/DD format
export const getTodayString = (): string => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
};