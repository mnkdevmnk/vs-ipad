# VS iPad – Bluetooth LE üzerinden MicroPython REPL (Nordic UART Service)
# boot.py tarafından içe aktarılır. Karta "vsipad_ble.py" olarak kopyala.
import bluetooth, io, os, micropython
from micropython import const

_IRQ_CONNECT = const(1)
_IRQ_DISCONNECT = const(2)
_IRQ_WRITE = const(3)
_IRQ_MTU = const(21)
_UART = bluetooth.UUID('6E400001-B5A3-F393-E0A9-E50E24DCCA9E')
_TX = (bluetooth.UUID('6E400003-B5A3-F393-E0A9-E50E24DCCA9E'), bluetooth.FLAG_NOTIFY | bluetooth.FLAG_READ)
_RX = (bluetooth.UUID('6E400002-B5A3-F393-E0A9-E50E24DCCA9E'), bluetooth.FLAG_WRITE | bluetooth.FLAG_WRITE_NO_RESPONSE)


class _BleStream(io.IOBase):
    def __init__(self, name):
        self.ble = bluetooth.BLE()
        self.ble.active(True)
        try:
            self.ble.config(mtu=247)
        except Exception:
            pass
        self.ble.irq(self._irq)
        ((self.tx, self.rx),) = self.ble.gatts_register_services(((_UART, (_TX, _RX)),))
        self.ble.gatts_set_buffer(self.rx, 512, True)
        self.conn = None
        self.mtu = 20
        self.inbuf = bytearray()
        self.outbuf = bytearray()
        self.busy = False
        n = name.encode()
        self.adv = bytes((2, 1, 6, len(n) + 1, 9)) + n
        self.resp = bytes((17, 7)) + bytes(_UART)
        self._advertise()

    def _advertise(self):
        self.ble.gap_advertise(100000, adv_data=self.adv, resp_data=self.resp)

    def _irq(self, ev, data):
        if ev == _IRQ_CONNECT:
            self.conn = data[0]
        elif ev == _IRQ_DISCONNECT:
            self.conn = None
            self._advertise()
        elif ev == _IRQ_WRITE:
            self.inbuf += self.ble.gatts_read(self.rx)
            if hasattr(os, 'dupterm_notify'):
                os.dupterm_notify(None)
        elif ev == _IRQ_MTU:
            self.mtu = max(20, data[1] - 3)

    def _flush(self, _=None):
        self.busy = False
        while self.outbuf and self.conn is not None:
            chunk = self.outbuf[:self.mtu]
            self.outbuf = self.outbuf[self.mtu:]
            try:
                self.ble.gatts_notify(self.conn, self.tx, chunk)
            except OSError:
                break

    def readinto(self, buf):
        if not self.inbuf:
            return None
        n = min(len(buf), len(self.inbuf))
        buf[:n] = self.inbuf[:n]
        self.inbuf = self.inbuf[n:]
        return n

    def write(self, buf):
        if self.conn is None:
            return len(buf)
        self.outbuf += buf
        if len(self.outbuf) > 4096:
            self.outbuf = self.outbuf[-4096:]
        if not self.busy:
            self.busy = True
            micropython.schedule(self._flush, None)
        return len(buf)

    def ioctl(self, op, arg):
        if op == 3:  # MP_STREAM_POLL
            return 1 if self.inbuf else 0
        return 0


_stream = None

def start(name='VSiPad-esp32'):
    global _stream
    if _stream is None:
        _stream = _BleStream(name)
        try:
            os.dupterm(_stream, 1)   # WebREPL 0. yuvayı kullanır
        except Exception:
            os.dupterm(_stream)
    return _stream
