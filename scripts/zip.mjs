// Minimal cross-platform zip writer (no dependencies) for platform uploads.
// Usage: node scripts/zip.mjs <dir> <out.zip>  — index.html ends up at the zip root.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

const [dir, out] = process.argv.slice(2);
const files = [];
const walk = (d) => {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
};
walk(dir);

const locals = [];
const centrals = [];
let offset = 0;
for (const file of files) {
  const name = Buffer.from(relative(dir, file).split(sep).join('/'));
  const data = readFileSync(file);
  const comp = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(0x21, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(comp.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(0x21, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(comp.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42);
  locals.push(local, name, comp);
  centrals.push(central, name);
  offset += 30 + name.length + comp.length;
}
const cd = Buffer.concat(centrals);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(cd.length, 12);
end.writeUInt32LE(offset, 16);
writeFileSync(out, Buffer.concat([...locals, cd, end]));
console.log(`${out}: ${files.length} files, ${(Buffer.concat([...locals, cd, end]).length / 1024).toFixed(0)} KB`);
