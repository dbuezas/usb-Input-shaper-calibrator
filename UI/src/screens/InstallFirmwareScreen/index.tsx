import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function InstallFirmwareScreen() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Install firmware</h2>
        <div className="text-muted-foreground mt-1 text-sm">
          Flash the RP2040-based USB accelerometer board with the compatible firmware before
          measuring.
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>1) Download firmware (UF2)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed">
          <div>
            This app expects a firmware build that streams accelerometer data over USB serial.
          </div>
          <div className="rounded-md border border-dashed p-3">
            <div className="text-muted-foreground text-xs">Firmware download (placeholder)</div>
            <div className="mt-1 font-mono text-sm">TODO: put your UF2 file/link here</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2) Put the RP2040 into bootloader mode</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm leading-relaxed">
          <ol className="list-decimal space-y-2 pl-5">
            <li>Unplug the board.</li>
            <li>
              Hold the <b>BOOT</b> button.
            </li>
            <li>While holding BOOT, plug it into your computer via USB.</li>
            <li>
              Release BOOT after it enumerates as a mass storage device (often called{' '}
              <span className="font-mono">RPI-RP2</span>).
            </li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3) Flash the UF2</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm leading-relaxed">
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              Drag-and-drop the downloaded <span className="font-mono">.uf2</span> onto the drive.
            </li>
            <li>The drive will disappear and the board will reboot automatically.</li>
          </ol>
          <div className="text-muted-foreground mt-3">
            After flashing, go to <b>Measure axis</b> and click <b>Connect</b>.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Hardware notes / compatibility</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm leading-relaxed">
          <div>
            Tested / intended for RP2040 + ADXL345 USB accelerometer boards (e.g.{' '}
            <b>Mellow Fly ADXL345 USB-C</b>).
          </div>
          <div className="rounded-md border p-3">
            <div className="font-semibold">USB-C cable warning</div>
            <div className="text-muted-foreground mt-1">
              Some of these boards don’t work with USB-C ↔ USB-C cables because the CC1/CC2
              resistors are missing (they forgot to solder them). Use a <b>USB-A → USB-C</b> cable
              (or an A-port adapter) for reliable power + enumeration.
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
