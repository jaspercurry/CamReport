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

// 4 corner points: [x, y] in image coords
// Order: top-left, top-right, bottom-right, bottom-left
export type Corners = [number, number][];

export interface CameraSession {
  id: string;
  name: string;
  card_type: number;
  corners: Corners | null;
  results: AnalysisResult[];
}

export interface Settings {
  screenshots_dir: string;
}

// V2: Camera + Calibration types

export interface CameraDevice {
  device_id: string;
  name: string;
  index: number;
  vid_pid: string;
  resolution?: number[];
}

export interface UVCControl {
  name: string;
  min: number;
  max: number;
  step: number;
  default: number;
  current: number;
  available: boolean;
}

export interface CalibrationStepMsg {
  type: string;
  phase?: string;
  phase_index?: number;
  step?: number;
  value?: number;
  range?: number[];
  error?: number;
  mean_delta_e?: number;
  final_delta_e?: number;
  iterations?: number;
  duration_s?: number;
  controls?: Record<string, number>;
  control?: string;
  session_id?: string;
  initial_delta_e?: number;
  final_value?: number;
  final_error?: number;
}
