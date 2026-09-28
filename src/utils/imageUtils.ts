/**
 * Image paste utilities for Paperling
 * Handles clipboard image extraction and saving to local files
 */

import { invoke } from '@tauri-apps/api/core';

/**
 * Extract image from clipboard event
 * Returns the first image file found in the clipboard, or null
 */
export function getImageFromClipboard(event: ClipboardEvent): File | null {
    const items = event.clipboardData?.items;
    if (!items) return null;

    for (const item of items) {
        if (item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) return file;
        }
    }
    return null;
}

/**
 * Convert a File/Blob to Uint8Array for sending to Rust
 */
export async function fileToBytes(file: File): Promise<Uint8Array> {
    const buffer = await file.arrayBuffer();
    return new Uint8Array(buffer);
}

/**
 * Get file extension from MIME type
 */
function getExtensionFromMime(mimeType: string): string {
    const mimeToExt: Record<string, string> = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'image/bmp': 'bmp',
        'image/svg+xml': 'svg',
    };
    return mimeToExt[mimeType] || 'png';
}

/**
 * Generate a unique image filename
 */
function generateImageName(mimeType: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const ext = getExtensionFromMime(mimeType);
    return `image-${timestamp}-${random}.${ext}`;
}

/**
 * Save image to local file and return the relative path
 */
export async function saveImageToFile(
    imageFile: File,
    mdFilePath: string
): Promise<string> {
    const imageBytes = await fileToBytes(imageFile);
    const imageName = generateImageName(imageFile.type);
    
    // Call Rust command to save the image
    const relativePath = await invoke<string>('save_image', {
        mdFilePath,
        imageData: Array.from(imageBytes), // Convert to array for serialization
        imageName,
    });
    
    return relativePath;
}

/**
 * Generate a markdown image tag with file path
 */
export function createMarkdownImage(imagePath: string, altText: string = 'image'): string {
    return `![${altText}](${imagePath})`;
}

/**
 * Insert text at cursor position in a string
 * Returns the new string and the new cursor position
 */
export function insertAtCursor(
    text: string,
    cursorPosition: number,
    insertText: string
): { newText: string; newCursorPosition: number } {
    const before = text.slice(0, cursorPosition);
    const after = text.slice(cursorPosition);
    
    // Add newlines around the image for better formatting
    const needsNewlineBefore = before.length > 0 && !before.endsWith('\n');
    const needsNewlineAfter = after.length > 0 && !after.startsWith('\n');
    
    const prefix = needsNewlineBefore ? '\n\n' : '';
    const suffix = needsNewlineAfter ? '\n\n' : '';
    
    const fullInsert = prefix + insertText + suffix;
    const newText = before + fullInsert + after;
    const newCursorPosition = cursorPosition + fullInsert.length;
    
    return { newText, newCursorPosition };
}
