import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { BOARDS, DEFAULT_BOARD_ID, type Board } from './boards';

const FlashSteps = ({ board }: { board: Board }) => {
  switch (board.flashing) {
    case 'uf2':
      return (
        <ol className="list-decimal space-y-2 pl-5">
          <li>Unplug the board.</li>
          <li>
            Hold the <b>BOOT</b> button and plug it into your computer via USB.
          </li>
          <li>
            Release BOOT when a drive called <span className="font-mono">RPI-RP2</span> appears.
          </li>
          <li>
            Drag-and-drop <span className="font-mono">{board.fileName}</span> onto the drive.
          </li>
          <li>The drive disappears and the board reboots automatically.</li>
        </ol>
      );
    case 'stm32':
      return (
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            Write <span className="font-mono">{board.fileName}</span> to address{' '}
            <span className="font-mono">0x08000000</span> with an ST-Link (e.g. STM32CubeProgrammer)
            or the STM32 serial bootloader (BOOT0 = 1, UART on PA9/PA10).
          </li>
          <li>Set BOOT0 back to 0 and reset the board.</li>
        </ol>
      );
    case 'stm32-msc-bootloader':
      return (
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            Start the USB bootloader (e.g. double-tap reset, if your bootloader was built with that
            option). It shows up as a drive.
          </li>
          <li>
            Copy <span className="font-mono">{board.fileName}</span> onto the drive.
          </li>
          <li>The board restarts into the firmware.</li>
        </ol>
      );
  }
};

export default function InstallFirmwareScreen() {
  const [boardId, setBoardId] = useState(DEFAULT_BOARD_ID);
  const board = BOARDS.find((b) => b.id === boardId) ?? BOARDS[0];

  return (
    <div className="mx-2 w-full space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Install firmware</h2>
        <div className="text-muted-foreground mt-1 text-sm">
          Flash your USB accelerometer board with the firmware for it before measuring.
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>1) Pick your board</CardTitle>
        </CardHeader>
        <CardContent>
          <RadioGroup value={boardId} onValueChange={setBoardId} aria-label="Board">
            {BOARDS.map((b) => (
              <label
                key={b.id}
                htmlFor={`board-${b.id}`}
                className={`hover:bg-muted flex cursor-pointer items-center gap-3 rounded-md p-2 text-sm ${b.id === boardId ? 'bg-muted' : ''}`}
              >
                <RadioGroupItem
                  value={b.id}
                  id={`board-${b.id}`}
                  className="border-muted-foreground"
                />
                <span className="font-medium">{b.name}</span>
                <span className="text-muted-foreground text-xs">
                  {b.chip}, {b.sampleRate} Hz
                </span>
              </label>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2) Download the firmware</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed">
          <div className="rounded-md border border-dashed p-3">
            <div className="text-muted-foreground text-xs">Firmware for {board.name}</div>
            <a
              className="mt-1 inline-flex font-mono text-sm underline"
              href={board.firmwareUrl}
              download={board.fileName}
              data-testid="firmware-download"
            >
              {board.fileName}
            </a>
          </div>
          {board.wiring && (
            <div>
              <div className="font-semibold">Wiring ({board.chip} on SPI)</div>
              <table className="mt-1 font-mono text-xs">
                <tbody>
                  {board.wiring.map(({ signal, pin }) => (
                    <tr key={signal}>
                      <td className="pr-4">{signal}</td>
                      <td>{pin}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="text-muted-foreground mt-1 text-xs">Also connect 3.3V and GND.</div>
            </div>
          )}
          {board.notes && <div className="text-muted-foreground">{board.notes}</div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3) Flash it</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm leading-relaxed">
          <FlashSteps board={board} />
          <div className="text-muted-foreground mt-3">
            After flashing, go to <b>Measure axis</b> and click <b>Connect</b>.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Hardware notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm leading-relaxed">
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
