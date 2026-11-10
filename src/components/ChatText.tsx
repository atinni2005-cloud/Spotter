import { StyleSheet, Text, View, type TextStyle } from 'react-native';
import { space } from '../lib/theme';

/**
 * Renders the light formatting the coach uses in chat: **bold**, *italic*,
 * bullet lists ("- " or "* "), numbered lists ("1. ") and paragraphs.
 * Anything else is shown as plain text.
 */
export function ChatText({ text, style }: { text: string; style: TextStyle }) {
  const blocks = text.replace(/\r/g, '').split(/\n{2,}/);
  return (
    <View style={{ gap: space.sm }}>
      {blocks.map((block, i) => (
        <Block key={i} block={block} style={style} />
      ))}
    </View>
  );
}

function Block({ block, style }: { block: string; style: TextStyle }) {
  const lines = block.split('\n').filter((l) => l.trim());
  if (!lines.length) return null;
  return (
    <View style={{ gap: 2 }}>
      {lines.map((raw, i) => {
        const line = raw.replace(/^#{1,6}\s+/, '');
        const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
        const numbered = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
        if (bullet || numbered) {
          const marker = bullet ? '•' : `${numbered![1]}.`;
          const body = bullet ? bullet[1] : numbered![2];
          return (
            <View key={i} style={styles.listRow}>
              <Text style={[style, styles.marker]}>{marker}</Text>
              <Text style={[style, { flex: 1 }]}>
                <Inline text={body} />
              </Text>
            </View>
          );
        }
        const heading = raw !== line;
        return (
          <Text key={i} style={[style, heading && { fontWeight: '800' }]}>
            <Inline text={line} />
          </Text>
        );
      })}
    </View>
  );
}

function Inline({ text }: { text: string }) {
  // Split on **bold** and *italic* runs, keeping the markers so we know which is which.
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g).filter(Boolean);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
          return (
            <Text key={i} style={{ fontWeight: '800' }}>
              {part.slice(2, -2)}
            </Text>
          );
        }
        if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
          return (
            <Text key={i} style={{ fontStyle: 'italic' }}>
              {part.slice(1, -1)}
            </Text>
          );
        }
        return part;
      })}
    </>
  );
}

const styles = StyleSheet.create({
  listRow: { flexDirection: 'row', gap: space.sm, paddingLeft: 2 },
  marker: { minWidth: 14 },
});
