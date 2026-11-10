/* VS iPad – wasm32 için eksik derleyici yardımcıları (compiler-rt yerine).
   Sysroot'ta libclang_rt.builtins yok; libc++ / long double kullanan kod bu
   fonksiyonları ister (__lttf2, __addtf3, __multi3 ...).
   long double (binary128) işlemleri double hassasiyetinde yapılır: öğrenci
   programları için yeterli. İçeride long double / __int128 aritmetiği YAPILMAZ
   (aksi halde derleyici yine bu fonksiyonları çağırır) – sadece bit işlemleri. */
typedef unsigned long long u64;
typedef long long i64;
typedef unsigned int u32;

typedef union { long double f; struct { u64 lo, hi; } w; } tf_t;
typedef union { double f; u64 u; } df_t;
typedef union { float f; u32 u; } sf_t;
typedef union { __int128 s; unsigned __int128 u; struct { u64 lo, hi; } w; } ti_t;

/* ---------- binary128 <-> double */
static long double from_d(double d) {
  df_t x; x.f = d; tf_t r;
  u64 sign = x.u >> 63, e = (x.u >> 52) & 0x7ff, m = x.u & 0xfffffffffffffULL;
  if (e == 0 && m == 0) { r.w.hi = sign << 63; r.w.lo = 0; return r.f; }
  if (e == 0x7ff) { r.w.hi = (sign << 63) | (0x7fffULL << 48) | (m >> 4); r.w.lo = m << 60; return r.f; }
  if (e == 0) { /* alt-normal: normalize et */
    int sh = 0; while (!(m & (1ULL << 52))) { m <<= 1; sh++; }
    m &= 0xfffffffffffffULL; e = 1 - sh;
    r.w.hi = (sign << 63) | ((u64)(e - 1023 + 16383) << 48) | (m >> 4); r.w.lo = m << 60; return r.f;
  }
  r.w.hi = (sign << 63) | ((e - 1023 + 16383) << 48) | (m >> 4); r.w.lo = m << 60;
  return r.f;
}
static double to_d(long double v) {
  tf_t x; x.f = v; df_t r;
  u64 sign = x.w.hi >> 63; i64 e = (x.w.hi >> 48) & 0x7fff;
  u64 mh = x.w.hi & 0xffffffffffffULL, ml = x.w.lo;
  u64 m = (mh << 4) | (ml >> 60);
  int roundup = (ml >> 59) & 1;
  if (e == 0x7fff) { r.u = (sign << 63) | (0x7ffULL << 52) | (m ? (m | 1) : 0); return r.f; }
  if (e == 0 && mh == 0 && ml == 0) { r.u = sign << 63; return r.f; }
  e = e - 16383 + 1023;
  if (e >= 0x7ff) { r.u = (sign << 63) | (0x7ffULL << 52); return r.f; }
  if (e <= 0) { /* alt-normal double */
    if (e < -52) { r.u = sign << 63; return r.f; }
    m = (m | (1ULL << 52)) >> (1 - e);
    r.u = (sign << 63) | m; return r.f;
  }
  r.u = (sign << 63) | ((u64)e << 52) | m;
  if (roundup) r.u += 1; /* taşma üst bite doğru yayılır, yine doğru */
  return r.f;
}
static int is_nan(long double v) { tf_t x; x.f = v; return ((x.w.hi >> 48) & 0x7fff) == 0x7fff && ((x.w.hi & 0xffffffffffffULL) | x.w.lo); }

long double __extenddftf2(double a) { return from_d(a); }
long double __extendsftf2(float a) { return from_d((double)a); }
double __trunctfdf2(long double a) { return to_d(a); }
float __trunctfsf2(long double a) { return (float)to_d(a); }

long double __addtf3(long double a, long double b) { return from_d(to_d(a) + to_d(b)); }
long double __subtf3(long double a, long double b) { return from_d(to_d(a) - to_d(b)); }
long double __multf3(long double a, long double b) { return from_d(to_d(a) * to_d(b)); }
long double __divtf3(long double a, long double b) { return from_d(to_d(a) / to_d(b)); }
long double __negtf2(long double a) { tf_t x; x.f = a; x.w.hi ^= 1ULL << 63; return x.f; }
long double __powitf2(long double a, int b) {
  double r = 1, x = to_d(a); int n = b < 0 ? -b : b;
  while (n) { if (n & 1) r *= x; x *= x; n >>= 1; }
  return from_d(b < 0 ? 1 / r : r);
}

static int cmp(long double a, long double b, int nanres) {
  if (is_nan(a) || is_nan(b)) return nanres;
  double x = to_d(a), y = to_d(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
int __lttf2(long double a, long double b) { return cmp(a, b, 1); }
int __letf2(long double a, long double b) { return cmp(a, b, 1); }
int __eqtf2(long double a, long double b) { return cmp(a, b, 1); }
int __netf2(long double a, long double b) { return cmp(a, b, 1); }
int __cmptf2(long double a, long double b) { return cmp(a, b, 1); }
int __gttf2(long double a, long double b) { return cmp(a, b, -1); }
int __getf2(long double a, long double b) { return cmp(a, b, -1); }
int __unordtf2(long double a, long double b) { return is_nan(a) || is_nan(b); }

int __fixtfsi(long double a) { return (int)to_d(a); }
i64 __fixtfdi(long double a) { return (i64)to_d(a); }
u32 __fixunstfsi(long double a) { return (u32)to_d(a); }
u64 __fixunstfdi(long double a) { return (u64)to_d(a); }
long double __floatsitf(int a) { return from_d((double)a); }
long double __floatditf(i64 a) { return from_d((double)a); }
long double __floatunsitf(u32 a) { return from_d((double)a); }
long double __floatunditf(u64 a) { return from_d((double)a); }

/* ---------- 128 bit tamsayı yardımcıları (64 bit parçalarla) */
static void mul64(u64 a, u64 b, u64 *hi, u64 *lo) {
  u64 a0 = a & 0xffffffffULL, a1 = a >> 32, b0 = b & 0xffffffffULL, b1 = b >> 32;
  u64 p00 = a0 * b0, p01 = a0 * b1, p10 = a1 * b0, p11 = a1 * b1;
  u64 mid = (p00 >> 32) + (p01 & 0xffffffffULL) + (p10 & 0xffffffffULL);
  *lo = (p00 & 0xffffffffULL) | (mid << 32);
  *hi = p11 + (p01 >> 32) + (p10 >> 32) + (mid >> 32);
}
__int128 __multi3(__int128 a, __int128 b) {
  ti_t x, y, r; x.s = a; y.s = b;
  u64 hi, lo; mul64(x.w.lo, y.w.lo, &hi, &lo);
  r.w.lo = lo; r.w.hi = hi + x.w.lo * y.w.hi + x.w.hi * y.w.lo;
  return r.s;
}
static ti_t shl(ti_t a, int n) { ti_t r; n &= 127; if (n == 0) return a; if (n >= 64) { r.w.hi = a.w.lo << (n - 64); r.w.lo = 0; } else { r.w.hi = (a.w.hi << n) | (a.w.lo >> (64 - n)); r.w.lo = a.w.lo << n; } return r; }
static ti_t shr(ti_t a, int n) { ti_t r; n &= 127; if (n == 0) return a; if (n >= 64) { r.w.lo = a.w.hi >> (n - 64); r.w.hi = 0; } else { r.w.lo = (a.w.lo >> n) | (a.w.hi << (64 - n)); r.w.hi = a.w.hi >> n; } return r; }
static ti_t sar(ti_t a, int n) { ti_t r; n &= 127; if (n == 0) return a; if (n >= 64) { r.w.lo = (u64)((i64)a.w.hi >> (n - 64)); r.w.hi = (u64)((i64)a.w.hi >> 63); } else { r.w.lo = (a.w.lo >> n) | (a.w.hi << (64 - n)); r.w.hi = (u64)((i64)a.w.hi >> n); } return r; }
__int128 __ashlti3(__int128 a, int n) { ti_t x; x.s = a; return shl(x, n).s; }
__int128 __lshrti3(__int128 a, int n) { ti_t x; x.s = a; return shr(x, n).s; }
__int128 __ashrti3(__int128 a, int n) { ti_t x; x.s = a; return sar(x, n).s; }

static int ge(ti_t a, ti_t b) { return a.w.hi != b.w.hi ? a.w.hi > b.w.hi : a.w.lo >= b.w.lo; }
static ti_t sub(ti_t a, ti_t b) { ti_t r; r.w.lo = a.w.lo - b.w.lo; r.w.hi = a.w.hi - b.w.hi - (a.w.lo < b.w.lo); return r; }
static ti_t neg(ti_t a) { ti_t z; z.w.lo = 0; z.w.hi = 0; return sub(z, a); }
static void udivmod(ti_t n, ti_t d, ti_t *q, ti_t *r) {
  ti_t qq, rr; qq.w.lo = qq.w.hi = 0; rr.w.lo = rr.w.hi = 0;
  if (!d.w.lo && !d.w.hi) { volatile int z = 0; z = 1 / z; } /* sıfıra bölme tuzağı */
  for (int i = 127; i >= 0; i--) {
    rr = shl(rr, 1);
    rr.w.lo |= (i >= 64 ? (n.w.hi >> (i - 64)) : (n.w.lo >> i)) & 1;
    if (ge(rr, d)) { rr = sub(rr, d); if (i >= 64) qq.w.hi |= 1ULL << (i - 64); else qq.w.lo |= 1ULL << i; }
  }
  if (q) *q = qq; if (r) *r = rr;
}
unsigned __int128 __udivti3(unsigned __int128 a, unsigned __int128 b) { ti_t x, y, q; x.u = a; y.u = b; udivmod(x, y, &q, 0); return q.u; }
unsigned __int128 __umodti3(unsigned __int128 a, unsigned __int128 b) { ti_t x, y, r; x.u = a; y.u = b; udivmod(x, y, 0, &r); return r.u; }
__int128 __divti3(__int128 a, __int128 b) {
  ti_t x, y, q; x.s = a; y.s = b; int sa = (i64)x.w.hi < 0, sb = (i64)y.w.hi < 0;
  if (sa) x = neg(x); if (sb) y = neg(y); udivmod(x, y, &q, 0); if (sa != sb) q = neg(q); return q.s;
}
__int128 __modti3(__int128 a, __int128 b) {
  ti_t x, y, r; x.s = a; y.s = b; int sa = (i64)x.w.hi < 0, sb = (i64)y.w.hi < 0;
  if (sa) x = neg(x); if (sb) y = neg(y); udivmod(x, y, 0, &r); if (sa) r = neg(r); return r.s;
}
