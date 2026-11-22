/** A coach reply: the website's small Markdown subset, with links into the app. */
import { Text, View } from "react-native";
import { parseReply, type Inline } from "../../../src/lib/coach/format";
import { targetFromPath } from "../../../src/lib/mobile/targets";
import { openTarget } from "../ui/navigate";
import { colors, space } from "../ui/theme";

function Inlines({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) => {
        if (p.kind === "bold") return <Text key={i} style={{ fontWeight: "700" }}>{p.text}</Text>;
        if (p.kind === "italic") return <Text key={i} style={{ fontStyle: "italic" }}>{p.text}</Text>;
        if (p.kind === "link") {
          const target = targetFromPath(p.href);
          return target ? (
            <Text key={i} style={{ color: colors.gold600, textDecorationLine: "underline" }} onPress={() => openTarget(target, { title: p.text })} accessibilityRole="link">
              {p.text}
            </Text>
          ) : (
            <Text key={i}>{p.text}</Text>
          );
        }
        return <Text key={i}>{p.text}</Text>;
      })}
    </>
  );
}

export function Reply({ text }: { text: string }) {
  const style = { fontSize: 16, lineHeight: 24, color: colors.ink };
  return (
    <View style={{ gap: space(2) }}>
      {parseReply(text).map((block, i) =>
        block.kind === "p" ? (
          <Text key={i} style={style}>
            <Inlines parts={block.content} />
          </Text>
        ) : (
          <View key={i} style={{ gap: space(1) }}>
            {block.items.map((item, j) => (
              <Text key={j} style={style}>
                {block.kind === "ol" ? `${j + 1}. ` : "• "}
                <Inlines parts={item} />
              </Text>
            ))}
          </View>
        ),
      )}
    </View>
  );
}
