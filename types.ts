export interface TreatmentItem {
  id: string;
  name: string;
  price: number;
  category: string;
}

export interface SelectedItem extends TreatmentItem {
  quantity: number;
  site: string; // "部位" (e.g., Upper Right 1)
}

export interface EstimateData {
  patientName: string;
  doctorName: string;
  date: string;
  items: SelectedItem[];
}

export interface SavedEstimate extends EstimateData {
  id: string;
  timestamp: number;
  totalAmount: number;
}