import { DEFAULT_AXIS_PADDING, getInnerSize, type AxisPadding } from './axis';

export const AxisLabels = ({
  width,
  height,
  xLabel,
  yLabel,
  y2Label,
  padding = DEFAULT_AXIS_PADDING,
}: {
  width: number;
  height: number;
  xLabel: string;
  yLabel: string;
  y2Label?: string;
  padding?: AxisPadding;
}) => {
  const { innerWidth, innerHeight } = getInnerSize({ width, height, padding });

  return (
    <svg width={width} height={height} className="pointer-events-none absolute inset-0">
      <g transform={`translate(${padding.left},${padding.top})`}>
        <text
          x={innerWidth / 2}
          y={innerHeight + (padding.bottom - 6)}
          textAnchor="middle"
          fill="rgba(255,255,255,0.7)"
          fontSize={10}
        >
          {xLabel}
        </text>

        <text
          transform="rotate(-90)"
          x={-innerHeight / 2}
          y={-(padding.left - 20)}
          textAnchor="middle"
          fill="rgba(255,255,255,0.7)"
          fontSize={10}
        >
          {yLabel}
        </text>

        {y2Label ? (
          <text
            transform="rotate(-90)"
            x={-innerHeight / 2}
            y={innerWidth + (padding.right - 12)}
            textAnchor="middle"
            fill="rgba(255,255,255,0.7)"
            fontSize={10}
          >
            {y2Label}
          </text>
        ) : null}
      </g>
    </svg>
  );
};
