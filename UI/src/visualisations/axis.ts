import { useEffect, type RefObject } from 'react';
import { select } from 'd3-selection';
import { axisBottom, axisLeft } from 'd3-axis';
import { scaleLinear } from 'd3-scale';
import { format } from 'd3-format';
import { VIS_AXIS_PADDING } from '@/constants';

export const DEFAULT_AXIS_PADDING = VIS_AXIS_PADDING;

export type AxisPadding = typeof VIS_AXIS_PADDING;

export const getInnerSize = ({
  width,
  height,
  padding,
}: {
  width: number;
  height: number;
  padding: AxisPadding;
}) => {
  return {
    innerWidth: Math.max(1, width - padding.left - padding.right),
    innerHeight: Math.max(1, height - padding.top - padding.bottom),
  };
};

export const useD3Axes = ({
  svgRef,
  width,
  height,
  xDomain,
  yDomain,
  xTicks,
  yTicks,
  xTickFormat,
  yTickFormat,
  padding = DEFAULT_AXIS_PADDING,
}: {
  svgRef: RefObject<SVGSVGElement | null>;
  width: number;
  height: number;
  xDomain: [number, number];
  yDomain: [number, number];
  xTicks: number;
  yTicks: number;
  xTickFormat?: (v: number) => string;
  yTickFormat?: (v: number) => string;
  padding?: AxisPadding;
}) => {
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const { innerWidth, innerHeight } = getInnerSize({ width, height, padding });

    const xScale = scaleLinear().domain(xDomain).range([0, innerWidth]);
    const yScale = scaleLinear().domain(yDomain).range([innerHeight, 0]);

    const svg = select(svgEl);
    svg.selectAll('*').remove();

    const g = svg
      .append('g')
      .attr('class', 'axes')
      .attr('transform', `translate(${padding.left},${padding.top})`);

    const xAxis = axisBottom(xScale)
      .ticks(xTicks)
      .tickFormat((d: number | { valueOf(): number }) =>
        xTickFormat ? xTickFormat(Number(d)) : format('~g')(Number(d))
      );

    const yAxis = axisLeft(yScale)
      .ticks(yTicks)
      .tickFormat((d: number | { valueOf(): number }) =>
        yTickFormat ? yTickFormat(Number(d)) : format('~g')(Number(d))
      );

    g.append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(xAxis);

    g.append('g').attr('class', 'y-axis').call(yAxis);

    g.selectAll('path, line').attr('stroke', 'rgba(255,255,255,0.25)');
    g.selectAll('text').attr('fill', 'rgba(255,255,255,0.7)').style('font-size', '10px');
  }, [svgRef, width, height, xTicks, yTicks, padding, xDomain, yDomain, xTickFormat, yTickFormat]);
};
