/**
 * Web Serial API type declarations
 * (Not yet in lib.dom.d.ts for all TS versions)
 */

interface SerialPort {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
}

interface SerialPortRequestOptions {
  filters?: { usbVendorId?: number; usbProductId?: number }[];
}

interface Serial {
  requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>;
  getPorts(): Promise<SerialPort[]>;
}

interface Navigator {
  serial: Serial;
}
