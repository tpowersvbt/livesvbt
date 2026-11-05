import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const source = process.argv[2];
if (!source) throw new Error('Provide the supplied portrait file path.');
const input = readFileSync(source);
const prefix = 'data:image/webp;base64,';
const image = input.subarray(0, prefix.length).toString() === prefix ? Buffer.from(input.toString().slice(prefix.length).trim(), 'base64') : input;
const extension = image[0] === 255 && image[1] === 216 ? 'jpg' : image.subarray(1, 4).toString() === 'PNG' ? 'png' : image.subarray(0, 4).toString() === 'RIFF' && image.subarray(8, 12).toString() === 'WEBP' ? 'webp' : null;
if (!extension) throw new Error('Portrait must be a JPEG, PNG or WebP image.');
mkdirSync('public', { recursive: true });
writeFileSync(`public/tim-power.${extension}`, image);
console.log(`Imported supplied portrait to public/tim-power.${extension}`);
