/** A conversation with the coach. Replies stream in as they're written. */
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View, type ScrollViewInstance } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "../../../src/api/client";
import type { Conversation } from "../../../src/api/types";
import { Reply } from "../../../src/coach/Reply";
import { sendToCoach } from "../../../src/coach/stream";
import { Button, Loading } from "../../../src/ui/components";
import { colors, space } from "../../../src/ui/theme";

type Message = { id: string; role: "user" | "assistant"; content: string };
const MAX_CHARS = 2000;

export default function ChatScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const [conversationId, setConversationId] = useState<string | null>(params.id === "new" ? null : params.id);
  const [messages, setMessages] = useState<Message[] | null>(params.id === "new" ? [] : null);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroll = useRef<ScrollViewInstance>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (params.id === "new") return;
    api<Conversation>(`/api/mobile/v1/coach/conversations/${params.id}`)
      .then((c) => setMessages(c.messages))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't open this conversation."));
  }, [params.id]);
  useEffect(() => () => abort.current?.abort(), []);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    setError(null);
    setSending(true);
    const replyId = `reply-${Date.now()}`;
    const mineId = `me-${Date.now()}`;
    let answered = false;
    setMessages((m) => [...(m ?? []), { id: mineId, role: "user", content: text }, { id: replyId, role: "assistant", content: "" }]);
    const controller = new AbortController();
    abort.current = controller;
    const setReply = (fn: (s: string) => string) => setMessages((m) => (m ?? []).map((x) => (x.id === replyId ? { ...x, content: fn(x.content) } : x)));
    try {
      for await (const event of sendToCoach({ conversationId, text, signal: controller.signal })) {
        if (event.type === "conversation") setConversationId(event.id);
        else if (event.type === "status") setStatus(event.text);
        else if (event.type === "text") {
          setStatus(null);
          answered = true;
          setReply((s) => s + event.text);
        } else if (event.type === "error") setError(event.message);
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        setError(e instanceof ApiError ? e.message : "The coach couldn't answer just now. Please try again.");
        // Nothing came back: put his message back in the box to send again.
        if (!answered) {
          setDraft(text);
          setMessages((m) => (m ?? []).filter((x) => x.id !== mineId));
        }
      }
    } finally {
      setStatus(null);
      setSending(false);
      setMessages((m) => (m ?? []).filter((x) => x.id !== replyId || x.content));
    }
  };

  const remove = () =>
    Alert.alert("Delete this conversation?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          if (conversationId) await api(`/api/coach/conversations/${conversationId}`, { method: "DELETE" }).catch(() => {});
          router.back();
        },
      },
    ]);

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <Stack.Screen options={{ title: "Coach", headerRight: conversationId ? () => <Button title="Delete" variant="quiet" onPress={remove} /> : undefined }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
        <ScrollView ref={scroll} contentContainerStyle={styles.list} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
          {messages === null && !error ? <Loading /> : null}
          {messages?.length === 0 ? (
            <Text style={styles.hint}>What's on your mind? Ask about anything from bedtime battles to talking with a teenager.</Text>
          ) : null}
          {messages?.map((m) =>
            m.role === "user" ? (
              <View key={m.id} style={styles.mine}>
                <Text style={styles.mineText}>{m.content}</Text>
              </View>
            ) : (
              <View key={m.id} style={styles.theirs}>
                {m.content ? <Reply text={m.content} /> : <Text style={styles.status}>{status ?? "Thinking…"}</Text>}
              </View>
            ),
          )}
          {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
        </ScrollView>
        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Write to the coach"
            multiline
            maxLength={MAX_CHARS}
            style={styles.input}
            accessibilityLabel="Message to the coach"
          />
          <Button title="Send" onPress={send} busy={sending} disabled={!draft.trim()} style={{ marginLeft: space(2) }} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  list: { padding: space(4), gap: space(3) },
  hint: { color: colors.muted, fontSize: 15, lineHeight: 22, textAlign: "center", marginTop: space(10), paddingHorizontal: space(6) },
  mine: { alignSelf: "flex-end", maxWidth: "85%", backgroundColor: colors.navy900, borderRadius: 14, padding: space(3) },
  mineText: { color: colors.white, fontSize: 16, lineHeight: 23 },
  theirs: { alignSelf: "stretch", backgroundColor: colors.white, borderRadius: 14, padding: space(4), borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  status: { color: colors.muted, fontStyle: "italic" },
  error: { color: colors.danger, textAlign: "center" },
  composer: { flexDirection: "row", alignItems: "flex-end", padding: space(3), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, backgroundColor: colors.white },
  input: { flex: 1, minHeight: 48, maxHeight: 140, borderRadius: 10, borderWidth: 1, borderColor: colors.navy100, paddingHorizontal: space(3), paddingTop: space(3), fontSize: 16, color: colors.ink, backgroundColor: colors.paper },
});
