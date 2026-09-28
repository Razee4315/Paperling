import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inputSvg = path.join(__dirname, 'new_logo.svg');
const iconsDir = path.join(__dirname, 'src-tauri', 'icons');

// Ensure icons directory exists
if (!fs.existsSync(iconsDir)) {
    fs.mkdirSync(iconsDir, { recursive: true });
}

const sizes = [
    { name: '32x32.png', size: 32 },
    { name: '128x128.png', size: 128 },
    { name: '128x128@2x.png', size: 256 },
    { name: 'icon.png', size: 512 },
    { name: 'Square30x30Logo.png', size: 30 },
    { name: 'Square44x44Logo.png', size: 44 },
    { name: 'Square71x71Logo.png', size: 71 },
    { name: 'Square89x89Logo.png', size: 89 },
    { name: 'Square107x107Logo.png', size: 107 },
    { name: 'Square142x142Logo.png', size: 142 },
    { name: 'Square150x150Logo.png', size: 150 },
    { name: 'Square284x284Logo.png', size: 284 },
    { name: 'Square310x310Logo.png', size: 310 },
    { name: 'StoreLogo.png', size: 50 },
];

async function generateIcons() {
    console.log('Reading SVG from:', inputSvg);
    const svgBuffer = fs.readFileSync(inputSvg);

    // Generate PNG icons
    for (const { name, size } of sizes) {
        const outputPath = path.join(iconsDir, name);
        await sharp(svgBuffer)
            .resize(size, size)
            .png()
            .toFile(outputPath);
        console.log(`Generated: ${name}`);
    }

    // Generate ICO (Windows) - use thick strokes for small sizes
    const icoSizes = [16, 20, 24, 32, 48, 64, 128, 256];
    const thickSvgPath = path.join(__dirname, 'logo_thick.svg');
    const thickSvgBuffer = fs.readFileSync(thickSvgPath);

    const icoImages = await Promise.all(
        icoSizes.map(async (size) => {
            // Use thick stroke version for small icons
            const svgToUse = size <= 48 ? thickSvgBuffer : svgBuffer;
            return await sharp(svgToUse, { density: 400 })
                .resize(size, size, {
                    kernel: sharp.kernel.lanczos3,
                    fit: 'contain',
                    background: { r: 0, g: 0, b: 0, alpha: 0 }
                })
                .png({ compressionLevel: 9 })
                .toBuffer();
        })
    );

    // Simple ICO file format
    const icoPath = path.join(iconsDir, 'icon.ico');
    const icoBuffer = createIco(icoImages, icoSizes);
    fs.writeFileSync(icoPath, icoBuffer);
    console.log('Generated: icon.ico');

    // Generate ICNS (macOS) - just use PNG as placeholder, real ICNS needs iconutil
    const icnsPath = path.join(iconsDir, 'icon.icns');
    await sharp(svgBuffer)
        .resize(512, 512)
        .png()
        .toFile(icnsPath.replace('.icns', '_512.png'));

    // Copy the largest PNG as a placeholder for ICNS
    const icnsPng = await sharp(svgBuffer).resize(512, 512).png().toBuffer();
    fs.writeFileSync(icnsPath, icnsPng);
    console.log('Generated: icon.icns (PNG placeholder)');

    console.log('Done! All icons generated.');
}

function createIco(images, sizes) {
    const numImages = images.length;
    const headerSize = 6 + (numImages * 16);

    let dataOffset = headerSize;
    const entries = [];

    for (let i = 0; i < numImages; i++) {
        const size = sizes[i];
        const data = images[i];
        entries.push({
            width: size >= 256 ? 0 : size,
            height: size >= 256 ? 0 : size,
            dataSize: data.length,
            dataOffset: dataOffset,
            data: data
        });
        dataOffset += data.length;
    }

    const totalSize = dataOffset;
    const buffer = Buffer.alloc(totalSize);
    let offset = 0;

    // ICO Header
    buffer.writeUInt16LE(0, offset); offset += 2; // Reserved
    buffer.writeUInt16LE(1, offset); offset += 2; // Type (1 = ICO)
    buffer.writeUInt16LE(numImages, offset); offset += 2; // Number of images

    // Directory entries
    for (const entry of entries) {
        buffer.writeUInt8(entry.width, offset); offset += 1;
        buffer.writeUInt8(entry.height, offset); offset += 1;
        buffer.writeUInt8(0, offset); offset += 1; // Color palette
        buffer.writeUInt8(0, offset); offset += 1; // Reserved
        buffer.writeUInt16LE(1, offset); offset += 2; // Color planes
        buffer.writeUInt16LE(32, offset); offset += 2; // Bits per pixel
        buffer.writeUInt32LE(entry.dataSize, offset); offset += 4;
        buffer.writeUInt32LE(entry.dataOffset, offset); offset += 4;
    }

    // Image data
    for (const entry of entries) {
        entry.data.copy(buffer, entry.dataOffset);
    }

    return buffer;
}

generateIcons().catch(console.error);
