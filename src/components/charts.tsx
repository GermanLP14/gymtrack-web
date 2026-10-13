import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { BarChart, LineChart } from 'react-native-gifted-charts';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

export type ChartPoint = { value: number; label: string; tooltip: string };

const Y_LABEL_WIDTH = 40;
const HEIGHT = 180;

/** Show at most ~5 x-axis labels so they never collide. */
function sparseLabel(i: number, n: number, label: string): string {
  const every = Math.max(1, Math.ceil(n / 5));
  return i % every === 0 || i === n - 1 ? label : '';
}

function compact(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`;
}

/** Single-series trend line with a press-and-drag crosshair tooltip. */
export function TrendChart({ data, width }: { data: ChartPoint[]; width: number }) {
  const theme = useTheme();
  const n = data.length;
  const plotWidth = width - Y_LABEL_WIDTH - 12;
  const spacing = n > 1 ? (plotWidth - 24) / (n - 1) : plotWidth;
  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // Zoom the y-axis onto the data so small strength gains stay visible.
  const pad = Math.max((max - min) * 0.2, max * 0.05, 1);
  const offset = Math.max(0, Math.floor(min - pad));

  return (
    <LineChart
      data={data.map((d, i) => ({ value: d.value, label: sparseLabel(i, n, d.label) }))}
      width={plotWidth}
      height={HEIGHT}
      spacing={spacing}
      initialSpacing={12}
      endSpacing={12}
      disableScroll
      yAxisOffset={offset}
      maxValue={Math.ceil(max + pad - offset)}
      noOfSections={4}
      color={theme.accent}
      thickness={2}
      curved={n > 2}
      areaChart
      startFillColor={theme.accent}
      endFillColor={theme.accent}
      startOpacity={0.18}
      endOpacity={0.01}
      dataPointsColor={theme.accent}
      dataPointsRadius={4}
      hideDataPoints={n > 20}
      yAxisLabelWidth={Y_LABEL_WIDTH}
      yAxisThickness={0}
      xAxisThickness={1}
      xAxisColor={theme.border}
      rulesColor={theme.border}
      rulesType="solid"
      yAxisTextStyle={styles.axisText(theme.textSecondary)}
      xAxisLabelTextStyle={styles.axisText(theme.textSecondary)}
      formatYLabel={compact}
      pointerConfig={{
        activatePointersOnLongPress: false,
        pointerStripColor: theme.textSecondary,
        pointerStripWidth: 1,
        pointerColor: theme.accent,
        radius: 5,
        pointerLabelWidth: 140,
        pointerLabelHeight: 48,
        autoAdjustPointerLabelPosition: true,
        pointerLabelComponent: (items: { index?: number }[], _secondary: unknown, index: number) => {
          const point = data[index ?? items[0]?.index ?? 0];
          return point ? <Tooltip text={point.tooltip} /> : null;
        },
      }}
    />
  );
}

/** Single-series bars; tapping a bar shows its value above the chart. */
export function BarsChart({ data, width, highlightLast }: { data: ChartPoint[]; width: number; highlightLast?: boolean }) {
  const theme = useTheme();
  const [selected, setSelected] = useState<number | null>(null);
  const n = data.length;
  const plotWidth = width - Y_LABEL_WIDTH - 12;
  const gap = n > 8 ? 4 : 10;
  const barWidth = Math.max(6, (plotWidth - 16 - gap * n) / n);
  const active = selected ?? (highlightLast ? n - 1 : null);

  return (
    <View>
      <ThemedText type="small" themeColor="textSecondary" style={{ minHeight: 20 }}>
        {active != null ? data[active]?.tooltip : 'Tocá una barra para ver el detalle'}
      </ThemedText>
      <BarChart
        data={data.map((d, i) => ({
          value: d.value,
          label: sparseLabel(i, n, d.label),
          frontColor: active === i || active == null ? theme.accent : theme.backgroundSelected,
          onPress: () => setSelected(i),
        }))}
        width={plotWidth}
        height={HEIGHT - 20}
        barWidth={barWidth}
        spacing={gap}
        initialSpacing={8}
        endSpacing={8}
        disableScroll
        noOfSections={3}
        barBorderTopLeftRadius={4}
        barBorderTopRightRadius={4}
        yAxisLabelWidth={Y_LABEL_WIDTH}
        yAxisThickness={0}
        xAxisThickness={1}
        xAxisColor={theme.border}
        rulesColor={theme.border}
        rulesType="solid"
        yAxisTextStyle={styles.axisText(theme.textSecondary)}
        xAxisLabelTextStyle={styles.axisText(theme.textSecondary)}
        formatYLabel={compact}
      />
    </View>
  );
}

function Tooltip({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.tooltip, { backgroundColor: theme.background, borderColor: theme.border }]}>
      <ThemedText type="small" style={{ fontWeight: 600 }}>
        {text}
      </ThemedText>
    </View>
  );
}

const styles = {
  axisText: (color: string) => ({ color, fontSize: 11 }),
  ...StyleSheet.create({
    tooltip: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4 },
  }),
};
