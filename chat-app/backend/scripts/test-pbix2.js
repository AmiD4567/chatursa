const http = require('http');
const stream = require('stream');

// Stream PBIX and list ZIP contents from central directory
const reportId = '5db4a340-56b5-4204-8d74-2d91ea49380c';
const url = `http://localhost:3001/api/pbi-proxy/fm/api/v2.0/CatalogItems(${reportId})/Content/$value`;

http.get(url, res => {
  // Read just the end of ZIP to find central directory
  // ZIP format: central directory is at the end, before the End of Central Directory (EOCD) record
  // EOCD signature: 0x06054b50
  // Central directory signature: 0x02014b50
  
  let buffer = Buffer.alloc(0);
  const maxRead = 1024 * 1024; // Read up to 1MB from end
  
  res.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    
    if (buffer.length > maxRead) {
      // Keep only the last 1MB  
      buffer = buffer.slice(buffer.length - maxRead);
    }
  });
  
  res.on('end', () => {
    // Find EOCD signature
    const eocdSig = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
    let eocdPos = -1;
    
    for (let i = buffer.length - 22; i >= 0; i--) {
      if (buffer[i] === 0x50 && buffer[i+1] === 0x4b && buffer[i+2] === 0x05 && buffer[i+3] === 0x06) {
        eocdPos = i;
        break;
      }
    }
    
    if (eocdPos === -1) {
      console.log('EOCD not found - need more data');
      return;
    }
    
    // Parse EOCD
    const numEntries = buffer.readUInt16LE(eocdPos + 8);
    const cdSize = buffer.readUInt32LE(eocdPos + 12);
    const cdOffset = buffer.readUInt32LE(eocdPos + 16);
    
    console.log(`Central Directory: ${numEntries} entries, offset=${cdOffset}, size=${cdSize}`);
    
    // Parse central directory entries
    let pos = buffer.length - (buffer.length - eocdPos) + cdOffset - (buffer.length - eocdPos - cdSize);
    // Simplified: just find all central directory records in our buffer
    
    const cdSig = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
    let count = 0;
    let searchPos = Math.max(0, buffer.length - cdSize - 22);
    
    for (let i = searchPos; i < buffer.length - 46; i++) {
      if (buffer[i] === 0x50 && buffer[i+1] === 0x4b && buffer[i+2] === 0x01 && buffer[i+3] === 0x02) {
        const fileNameLen = buffer.readUInt16LE(i + 28);
        const extraLen = buffer.readUInt16LE(i + 30);
        const commentLen = buffer.readUInt16LE(i + 32);
        const compressedSize = buffer.readUInt32LE(i + 20);
        const uncompressedSize = buffer.readUInt32LE(i + 24);
        const fileName = buffer.slice(i + 46, i + 46 + fileNameLen).toString('utf8');
        
        console.log(`  ${fileName} (compressed=${compressedSize}, uncompressed=${uncompressedSize})`);
        
        count++;
        i += 45 + fileNameLen + extraLen + commentLen;
      }
    }
    
    console.log(`\nTotal files shown: ${count}`);
  });
}).on('error', console.error);
