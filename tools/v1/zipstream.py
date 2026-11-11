"""Extract entries under a prefix from a zip arriving on stdin (Dropbox folder zips: streamed, with data descriptors)."""
import struct, zlib, sys, os
want, outdir = sys.argv[1].encode(), sys.argv[2]
src = sys.stdin.buffer; buf = bytearray(); eof = False
def fill(n):
    global eof
    while len(buf) < n and not eof:
        b = src.read(1 << 22)
        if not b: eof = True; break
        buf.extend(b)
    return len(buf) >= n
def take(n): b = bytes(buf[:n]); del buf[:n]; return b
def skip_descriptor():
    # 32-bit (16 bytes incl. signature) or zip64 (24) descriptor; pick the one followed by a header
    fill(28)
    off = 4 if buf[:4] == b'PK\x07\x08' else 0
    for L in (off + 12, off + 20):
        if buf[L:L + 4] in (b'PK\x03\x04', b'PK\x01\x02'): del buf[:L]; return
    del buf[:off + 12]
while fill(30):
    if buf[:4] != b'PK\x03\x04': print('end of entries:', bytes(buf[:4])); break
    ver, flag, meth, t, d, crc, csz, usz, nl, xl = struct.unpack('<HHHHHIIIHH', buf[4:30])
    fill(30 + nl + xl); h = take(30 + nl + xl); name = h[30:30 + nl]
    keep = name.startswith(want) and not name.endswith(b'/')
    out = None
    if keep:
        p = os.path.join(outdir, name.decode())
        if os.path.exists(p) and not os.path.exists(p + '.part'): keep = False   # already complete
        else: os.makedirs(os.path.dirname(p), exist_ok=True); open(p + '.part', 'w').close(); out = open(p, 'wb')
    if not (flag & 8):
        left = csz; dec = zlib.decompressobj(-15) if meth == 8 else None
        while left:
            fill(min(left, 1 << 22)); c = take(min(left, len(buf))); left -= len(c)
            if not c: break
            if out: out.write(dec.decompress(c) if dec else c)
    elif meth == 8:
        dec = zlib.decompressobj(-15)
        while not dec.eof:
            if not fill(1): print('truncated', name); sys.exit(1)
            c = take(len(buf)); o = dec.decompress(c)
            if out: out.write(o)
            if dec.unused_data: buf[:0] = dec.unused_data
        skip_descriptor()
    else:
        n = 0
        while True:
            fill(1 << 20)
            k = buf.find(b'PK\x07\x08')
            while k >= 0:
                if len(buf) < k + 28: fill(k + 28)
                sz32 = struct.unpack('<I', buf[k + 8:k + 12])[0]; sz64 = struct.unpack('<Q', buf[k + 8:k + 16])[0]
                if (sz32 == n + k and buf[k + 16:k + 20] in (b'PK\x03\x04', b'PK\x01\x02')) or (sz64 == n + k and buf[k + 24:k + 28] in (b'PK\x03\x04', b'PK\x01\x02')): break
                k = buf.find(b'PK\x07\x08', k + 1)
            if k >= 0:
                c = take(k); out and out.write(c); n += k; skip_descriptor(); break
            if eof: print('truncated stored', name); sys.exit(1)
            c = take(max(0, len(buf) - 32)); out and out.write(c); n += len(c)
    if out: out.close(); os.remove(p + '.part'); print('extracted', name.decode(), os.path.getsize(p) // 1000, 'kB', flush=True)
    if eof and not buf: break
