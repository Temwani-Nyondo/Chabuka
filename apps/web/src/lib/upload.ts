import { supabase } from './supabase';

// Uploads an image file to the public `avatars` bucket and returns its URL.
// Each upload gets a random path (no overwrites), matching the bucket's
// authenticated-insert policy.
export async function uploadImage(folder: string, file: File): Promise<string> {
  if (!supabase) throw new Error('Storage is not configured.');
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: false });
  if (error) throw new Error(error.message);
  return supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
}
