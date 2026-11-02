import type { ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

/** Dos campos relacionados se apilan cuando el ancho o la letra requieren más espacio. */
export function PatientFieldRow({ children }: { children: ReactNode[] }) {
  const { width, fontScale } = useWindowDimensions();
  const stacked = width < 360 || fontScale >= 1.2;
  return (
    <View style={[styles.row, stacked && styles.stacked]}>
      {children.map((child, index) => (
        <View key={index} style={styles.cell}>
          {child}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  stacked: { flexDirection: 'column', alignItems: 'stretch' },
  cell: { flex: 1, minWidth: 0 },
});
