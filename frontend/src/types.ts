export interface PatchResult {
  name: string;
  row: number;
  col: number;
  ref_lab: number[];
  captured_lab: number[];
  captured_rgb: number[];
  ref_rgb: number[];
  delta_e: number;
  is_gray: boolean;
}

export interface Recommendations {
  white_balance: string;
  tint: string;
  saturation: string;
  exposure: string;
  contrast: string;
}

export interface AnalysisResult {
  image_path: string;
  mean_delta_e: number;
  patches: PatchResult[];
  recommendations: Recommendations;
  timestamp: string;
}

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CameraSession {
  id: string;
  name: string;
  card_type: number;
  rectangle: Rectangle | null;
  results: AnalysisResult[];
}

export interface Settings {
  screenshots_dir: string;
}
