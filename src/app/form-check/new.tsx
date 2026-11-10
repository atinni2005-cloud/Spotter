import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Button, Card, ErrorText, Input, Label, Screen } from '../../components/ui';
import { startFormCheck } from '../../lib/api';
import { extractFrames, type PickedVideo, pickSetVideo, type Source, uploadSetVideo } from '../../lib/media';
import { colors, space } from '../../lib/theme';
import { useAuth } from '../../providers/AuthProvider';

export default function NewFormCheck() {
  const params = useLocalSearchParams<{ exercise?: string; setLogId?: string }>();
  const { session } = useAuth();
  const [exercise, setExercise] = useState(params.exercise ?? '');
  const [notes, setNotes] = useState('');
  const [video, setVideo] = useState<PickedVideo | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(source: Source) {
    setError(null);
    try {
      const picked = await pickSetVideo(source);
      if (picked) setVideo(picked);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open the camera');
    }
  }

  async function submit() {
    if (!video || !session) return;
    if (!exercise.trim()) return setError('Which exercise is this?');
    setError(null);
    try {
      setStep('Reading your video…');
      const frames = await extractFrames(video);
      if (frames.length < 3) throw new Error('Could not read that video. Try filming it again.');
      setStep('Uploading…');
      const videoPath = await uploadSetVideo(session.user.id, video);
      setStep('Sending to your coach…');
      const { id } = await startFormCheck({
        exerciseName: exercise.trim(),
        videoPath,
        frames,
        durationS: video.durationMs ? video.durationMs / 1000 : undefined,
        setLogId: params.setLogId || null,
        notes,
      });
      router.replace({ pathname: '/form-check/[id]', params: { id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setStep(null);
    }
  }

  const seconds = video?.durationMs ? Math.round(video.durationMs / 1000) : null;

  return (
    <Screen scroll edges={['bottom']}>
      <Card style={{ gap: space.xs }}>
        <Text style={styles.cardLabel}>HOW TO FILM</Text>
        <Text style={styles.tip}>• Prop your phone up 2 to 3 metres away, side-on to you.</Text>
        <Text style={styles.tip}>• Get your whole body and the weight in the frame.</Text>
        <Text style={styles.tip}>• Film your first working set, 60 seconds max.</Text>
        <Text style={styles.tip}>• Your feedback is ready about a minute after you send it.</Text>
      </Card>

      <Label>Exercise</Label>
      <Input value={exercise} onChangeText={setExercise} placeholder="e.g. Barbell back squat" />

      {video ? (
        <Card>
          <Text style={styles.ready}>Video ready{seconds ? ` (${seconds} s)` : ''} ✓</Text>
        </Card>
      ) : null}

      <Button
        title={video ? 'Film again' : '🎥  Film my set'}
        variant={video ? 'secondary' : 'primary'}
        onPress={() => choose('camera')}
        disabled={Boolean(step)}
      />
      <Button title="Choose a video" variant="secondary" onPress={() => choose('library')} disabled={Boolean(step)} />

      {video ? (
        <>
          <Label>Anything to mention? (optional)</Label>
          <Input
            value={notes}
            onChangeText={setNotes}
            placeholder='e.g. "felt it in my lower back on the last rep"'
            multiline
          />
          <Button title={step ?? 'Get feedback'} onPress={submit} loading={Boolean(step)} />
          {step ? <Text style={styles.muted}>{step}</Text> : null}
        </>
      ) : null}

      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  cardLabel: { color: colors.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.8 },
  tip: { color: colors.text, fontSize: 15, lineHeight: 22 },
  ready: { color: colors.accent, fontSize: 16, fontWeight: '700' },
  muted: { color: colors.muted, fontSize: 14, textAlign: 'center' },
});
