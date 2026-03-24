export type Point = [number, number];
export type Extent = [Point, Point];
export type Color = [number, number, number];

export type LinePattern = 'None' | 'Solid' | 'Dash' | 'Dot' | 'DashDot' | 'DashDotDot';
export type FillPattern =
  | 'None' | 'Solid' | 'Horizontal' | 'Vertical' | 'Cross'
  | 'Forward' | 'Backward' | 'CrossDiag'
  | 'HorizontalCylinder' | 'VerticalCylinder' | 'Sphere';
export type ArrowType = 'None' | 'Open' | 'Filled' | 'Half';
export type Smooth = 'None' | 'Bezier';
export type TextAlignment = 'Left' | 'Center' | 'Right';
export type TextStyle = 'Bold' | 'Italic' | 'UnderLine';

interface GraphicBase {
  visible: boolean;
  origin: Point;
  rotation: number;
}

interface FilledShape extends GraphicBase {
  lineColor: Color;
  fillColor: Color;
  pattern: LinePattern;
  fillPattern: FillPattern;
  lineThickness: number;
}

export interface LineGraphic extends GraphicBase {
  type: 'Line';
  points: Point[];
  color: Color;
  pattern: LinePattern;
  thickness: number;
  arrow: [ArrowType, ArrowType];
  arrowSize: number;
  smooth: Smooth;
}

export interface RectangleGraphic extends FilledShape {
  type: 'Rectangle';
  extent: Extent;
  radius: number;
}

export interface EllipseGraphic extends FilledShape {
  type: 'Ellipse';
  extent: Extent;
  startAngle: number;
  endAngle: number;
}

export interface PolygonGraphic extends FilledShape {
  type: 'Polygon';
  points: Point[];
  smooth: Smooth;
}

export interface TextGraphic extends GraphicBase {
  type: 'Text';
  extent: Extent;
  textString: string;
  fontSize: number;
  textColor: Color;
  horizontalAlignment: TextAlignment;
  textStyle: TextStyle[];
}

export interface BitmapGraphic extends GraphicBase {
  type: 'Bitmap';
  extent: Extent;
  fileName: string;
  imageSource: string;
}

export type Graphic =
  | LineGraphic | RectangleGraphic | EllipseGraphic
  | PolygonGraphic | TextGraphic | BitmapGraphic;

export interface Transformation {
  extent: Extent;
  rotation: number;
  origin: Point;
}

export interface DiagramComponent {
  name: string;
  typeName: string;
  transformation: Transformation;
  visible: boolean;
  sourceLine: number;
}

export interface DiagramConnection {
  from: string;
  to: string;
  line: LineGraphic;
}

export interface CoordinateSystem {
  extent: Extent;
  preserveAspectRatio: boolean;
}

export const DEFAULT_COORDINATE_SYSTEM: CoordinateSystem = {
  extent: [[-100, -100], [100, 100]],
  preserveAspectRatio: true,
};

export interface LayerAnnotation {
  coordinateSystem: CoordinateSystem;
  graphics: Graphic[];
}

export interface DiagramModel {
  className: string;
  filePath: string;
  diagram: LayerAnnotation;
  icon?: LayerAnnotation;
  components: DiagramComponent[];
  connections: DiagramConnection[];
}
