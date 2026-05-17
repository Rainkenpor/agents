interface RootObject {
  version: string;
  children: TreeNode[];
}

interface TreeNode {
  type: string;
  id: string;
  name: string;
  x?: number;
  y?: number;
  width?: number | string;
  height?: number | string;
  fill?: string;
  content?: string;
  layout?: string;
  padding?: number[];
  justifyContent?: string;
  alignItems?: string;
  gap?: number;
  clip?: boolean;
  cornerRadius?: number;
  textGrowth?: string;
  letterSpacing?: number;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string;
  iconFontName?: string;
  iconFontFamily?: string;
  stroke?: Stroke;
  effect?: Effect;
  children?: TreeNode[];
}

interface Effect {
  type: string;
  shadowType: string;
  color: string;
  offset: Offset;
  blur: number;
}

interface Offset {
  x: number;
  y: number;
}

interface Stroke {
  align?: string;
  thickness: number;
  fill?: string;
}
