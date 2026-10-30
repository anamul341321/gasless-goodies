async function encryptionKey() {
 const material = process.env['DAILY_CLAIM_ENCRYPTION_KEY'];
 if (!material) throw new Error('কী সুরক্ষার ব্যবস্থা পাওয়া যাচ্ছে না');
 const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
 return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encryptCollectionKey(value: string) {
 const iv = crypto.getRandomValues(new Uint8Array(12));
 const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(), new TextEncoder().encode(value)));
 const bytes = new Uint8Array(iv.length + encrypted.length); bytes.set(iv); bytes.set(encrypted, iv.length);
 return 'v1:' + btoa(Array.from(bytes, v => String.fromCharCode(v)).join(''));
}
export async function decryptCollectionKey(value: string) {
 if (!value.startsWith('v1:')) throw new Error('Invalid encrypted key');
 const bytes = Uint8Array.from(atob(value.slice(3)), c => c.charCodeAt(0));
 return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0,12) }, await encryptionKey(), bytes.slice(12)));
}
