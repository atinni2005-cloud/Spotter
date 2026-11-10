import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { supabase } from './supabase';

export type Source = 'camera' | 'library';

/** Resize an image to at most `maxWidth` pixels wide and return it as base64 JPEG. */
async function toJpegBase64(uri: string, maxWidth: number, width?: number): Promise<string> {
  const context = ImageManipulator.manipulate(uri);
  if (!width || width > maxWidth) context.resize({ width: maxWidth });
  const image = await context.renderAsync();
  const result = await image.saveAsync({ compress: 0.6, format: SaveFormat.JPEG, base64: true });
  if (!result.base64) throw new Error('Could not read the image');
  return result.base64;
}

async function ensurePermission(source: Source): Promise<boolean> {
  const res =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  return res.granted;
}

/** Take or choose a food photo. Returns a small JPEG (base64) ready to send, or null if cancelled. */
export async function pickMealPhoto(source: Source): Promise<{ uri: string; base64: string } | null> {
  if (!(await ensurePermission(source))) {
    throw new Error(source === 'camera' ? 'Spotter needs camera access. Turn it on in Settings.' : 'Spotter needs photo access. Turn it on in Settings.');
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: 'images', quality: 0.8 };
  const result =
    source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  return { uri: asset.uri, base64: await toJpegBase64(asset.uri, 1024, asset.width) };
}

export type PickedVideo = { uri: string; durationMs: number; mimeType: string };

/** Film or choose a video of a set (max 60 seconds). Returns null if cancelled. */
export async function pickSetVideo(source: Source): Promise<PickedVideo | null> {
  if (!(await ensurePermission(source))) {
    throw new Error(source === 'camera' ? 'Spotter needs camera access. Turn it on in Settings.' : 'Spotter needs video access. Turn it on in Settings.');
  }
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: 'videos',
    videoMaxDuration: 60,
    videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
  };
  const result =
    source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  return {
    uri: asset.uri,
    durationMs: asset.duration ?? 0,
    mimeType: asset.mimeType ?? (asset.uri.toLowerCase().endsWith('.mov') ? 'video/quicktime' : 'video/mp4'),
  };
}

/** Still frames spread evenly across the video, as small base64 JPEGs. */
export async function extractFrames(video: PickedVideo, count = 10): Promise<{ t: number; data: string }[]> {
  const duration = video.durationMs > 0 ? video.durationMs : 10_000;
  const frames: { t: number; data: string }[] = [];
  for (let i = 0; i < count; i++) {
    // Skip the very first and last moments, which are usually walking in and out of frame.
    const time = Math.round(duration * ((i + 0.5) / count));
    try {
      const thumb = await VideoThumbnails.getThumbnailAsync(video.uri, { time, quality: 0.7 });
      frames.push({ t: time / 1000, data: await toJpegBase64(thumb.uri, 768, thumb.width) });
    } catch {
      // A frame near the end can fail on some videos; the others are enough.
    }
  }
  return frames;
}

/** Upload the video to the user's private folder. Returns its storage path. */
export async function uploadSetVideo(userId: string, video: PickedVideo): Promise<string> {
  const ext = video.mimeType === 'video/quicktime' ? 'mov' : 'mp4';
  const path = `${userId}/${Date.now()}.${ext}`;
  const bytes = await new File(video.uri).arrayBuffer();
  const { error } = await supabase.storage.from('form-videos').upload(path, bytes, { contentType: video.mimeType });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return path;
}
