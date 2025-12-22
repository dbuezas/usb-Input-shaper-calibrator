import serial
import serial.tools.list_ports
import binascii
import threading
import sys

def list_serial_ports():
    ports = serial.tools.list_ports.comports()
    print("Available serial ports:")
    for i, p in enumerate(ports):
        print(f"  {i}: {p.device}  ({p.description})")
    return ports

def reader_thread(ser):
    """ Continuously read and print incoming data as hex """
    while True:
        try:
            data = ser.read(1024)
            if data:
                print("\nrecv:", data.hex(" "))
                print("hex> ", end="", flush=True)
        except:
            return

def main():
    ports = list_serial_ports()
    if not ports:
        print("No serial ports found.")
        return

    choice = input("Select port index: ").strip()
    if not choice.isdigit() or int(choice) >= len(ports):
        print("Invalid selection.")
        return

    port_name = ports[int(choice)].device
    print(f"Opening {port_name}…")

    ser = serial.Serial(port_name, 115200, timeout=0.01)

    print("Ready. Enter hex bytes (e.g. '01 02 00 10 12 C1').")
    print("Incoming data will be printed automatically.\n")

    # Start background reader
    t = threading.Thread(target=reader_thread, args=(ser,), daemon=True)
    t.start()

    while True:
        try:
            cmd = input("hex> ").strip()
        except EOFError:
            break

        if cmd.lower() == "exit":
            break

        cmd_clean = cmd.replace(" ", "")
        if not cmd_clean:
            continue

        try:
            ser.write(binascii.unhexlify(cmd_clean))
        except Exception as e:
            print(f"Error: {e}")

    ser.close()

if __name__ == "__main__":
    main()
