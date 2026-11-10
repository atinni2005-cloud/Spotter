import { router, useNavigation } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ChatText } from '../../components/ChatText';
import { streamCoach } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { colors, radius, space } from '../../lib/theme';
import { useAuth } from '../../providers/AuthProvider';

type UiMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  planId?: string | null;
  status?: string;
  replies?: string[];
  pending?: boolean;
  error?: boolean;
};

const SUGGESTIONS = [
  "I'm wiped out today. What should I do?",
  'What should I eat after training?',
  "I've hit a plateau on bench. Ideas?",
  'Is creatine worth taking?',
  'Build my plan for this week',
];

export default function Coach() {
  const { profile, session } = useAuth();
  const navigation = useNavigation();
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    supabase
      .from('chat_messages')
      .select('id, role, content, plan_id')
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        setMessages((data ?? []).map((m) => ({ id: m.id, role: m.role, content: m.content, planId: m.plan_id })));
        setLoadingHistory(false);
      });
    return () => abortRef.current?.abort();
  }, []);

  const clearChat = useCallback(() => {
    if (sending) return;
    Alert.alert(
      'Start a new chat?',
      'This clears your conversation with the coach. Your plan, meals and workouts stay.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            const userId = session?.user.id;
            if (!userId) return;
            const { error } = await supabase.from('chat_messages').delete().eq('user_id', userId);
            if (error) Alert.alert('Could not clear the chat', error.message);
            else setMessages([]);
          },
        },
      ],
    );
  }, [sending, session?.user.id]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight:
        messages.length > 0
          ? () => (
              <Pressable onPress={clearChat} hitSlop={10} style={{ paddingHorizontal: space.lg }}>
                <Text style={{ color: colors.accent, fontWeight: '700', fontSize: 15 }}>New chat</Text>
              </Pressable>
            )
          : undefined,
    });
  }, [navigation, clearChat, messages.length]);

  const updateReply = useCallback((id: string, patch: (m: UiMessage) => Partial<UiMessage>) => {
    setMessages((list) => list.map((m) => (m.id === id ? { ...m, ...patch(m) } : m)));
  }, []);

  async function send(text: string) {
    const message = text.trim();
    if (!message || sending) return;
    setInput('');
    setSending(true);

    const replyId = `reply-${Date.now()}`;
    // The list is inverted, so newest messages go first. Old quick replies go away once you answer.
    setMessages((list) => [
      { id: replyId, role: 'assistant', content: '', pending: true },
      { id: `user-${Date.now()}`, role: 'user', content: message },
      ...list.map((m) => (m.replies ? { ...m, replies: undefined } : m)),
    ]);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamCoach(
        message,
        (event) => {
          if (event.type === 'text')
            updateReply(replyId, (m) => ({ content: m.content + event.text, status: undefined }));
          else if (event.type === 'status') updateReply(replyId, () => ({ status: event.text }));
          else if (event.type === 'plan') updateReply(replyId, () => ({ planId: event.planId, status: undefined }));
          else if (event.type === 'suggestions') updateReply(replyId, () => ({ replies: event.replies }));
          else if (event.type === 'done') {
            // The reply is finished; quick replies may still arrive after this.
            updateReply(replyId, () => ({ pending: false, status: undefined }));
            setSending(false);
          } else if (event.type === 'error')
            updateReply(replyId, (m) => ({ content: m.content || event.message, error: !m.content }));
        },
        controller.signal,
      );
    } catch (e) {
      updateReply(replyId, (m) => ({
        content: m.content || (e instanceof Error ? e.message : 'Something went wrong'),
        error: !m.content,
      }));
    } finally {
      updateReply(replyId, () => ({ pending: false, status: undefined }));
      setSending(false);
    }
  }

  const empty = !loadingHistory && messages.length === 0;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      {loadingHistory ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : empty ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>Hey{profile?.display_name ? ` ${profile.display_name}` : ''} 👋</Text>
          <Text style={styles.emptyText}>
            I'm your Spotter coach. Ask me anything: training, food, recovery, motivation. Or just tell me how your
            day's going.
          </Text>
          <View style={{ gap: space.sm, marginTop: space.lg }}>
            {SUGGESTIONS.map((s) => (
              <Pressable key={s} style={styles.suggestion} onPress={() => send(s)}>
                <Text style={styles.suggestionText}>{s}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        <FlatList
          inverted
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: space.lg, gap: space.md }}
          extraData={sending}
          renderItem={({ item, index }) => (
            <Bubble message={item} onReply={index === 0 && !sending ? send : undefined} />
          )}
          keyboardShouldPersistTaps="handled"
        />
      )}

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Ask your coach…"
          placeholderTextColor={colors.muted}
          multiline
          maxLength={4000}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          onPress={() => send(input)}
          disabled={sending || !input.trim()}
          style={[styles.send, (sending || !input.trim()) && { opacity: 0.4 }]}
        >
          {sending ? <ActivityIndicator color={colors.accentText} /> : <Text style={styles.sendText}>↑</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function Bubble({ message, onReply }: { message: UiMessage; onReply?: (text: string) => void }) {
  const mine = message.role === 'user';
  const replies = onReply && !mine ? (message.replies ?? []) : [];
  return (
    <View style={{ gap: space.sm }}>
      <View
        style={[styles.bubble, mine ? styles.mine : styles.theirs, message.error && { borderColor: colors.danger }]}
      >
        {message.content ? (
          mine ? (
            <Text style={[styles.bubbleText, { color: colors.accentText }]}>{message.content}</Text>
          ) : (
            <ChatText text={message.content} style={styles.bubbleText} />
          )
        ) : null}
        {message.pending && (message.status || !message.content) ? (
          <View style={styles.statusRow}>
            <ActivityIndicator size="small" color={colors.muted} />
            {message.status ? <Text style={styles.status}>{message.status}</Text> : null}
          </View>
        ) : null}
        {message.planId ? (
          <Pressable style={styles.planLink} onPress={() => router.navigate('/plan')}>
            <Text style={styles.planLinkText}>View your new plan →</Text>
          </Pressable>
        ) : null}
      </View>
      {replies.length ? (
        <View style={styles.replies}>
          {replies.map((r) => (
            <Pressable key={r} style={styles.replyChip} onPress={() => onReply?.(r)}>
              <Text style={styles.replyText}>{r}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyWrap: { flex: 1, padding: space.xl, justifyContent: 'center' },
  emptyTitle: { color: colors.text, fontSize: 26, fontWeight: '800' },
  emptyText: { color: colors.muted, fontSize: 16, lineHeight: 23, marginTop: space.sm },
  suggestion: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: space.md,
  },
  suggestionText: { color: colors.text, fontSize: 15 },
  bubble: { maxWidth: '85%', borderRadius: radius.lg, padding: space.md, borderWidth: 1 },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.accent, borderColor: colors.accent },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.card, borderColor: colors.border },
  bubbleText: { color: colors.text, fontSize: 16, lineHeight: 22 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 2 },
  status: { color: colors.muted, fontSize: 14 },
  planLink: {
    marginTop: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    backgroundColor: colors.cardAlt,
    borderRadius: radius.sm,
    alignSelf: 'flex-start',
  },
  planLinkText: { color: colors.accent, fontWeight: '700' },
  replies: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, maxWidth: '92%' },
  replyChip: {
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.pill,
    paddingVertical: space.xs + 2,
    paddingHorizontal: space.md,
  },
  replyText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    padding: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: space.md,
    paddingTop: space.md,
    paddingBottom: space.md,
  },
  send: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: { color: colors.accentText, fontSize: 22, fontWeight: '900' },
});
