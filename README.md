# Gribouillot
A software to draw geometric figures on a map, with a layer system and powerful functionalities.

## Build Instructions

### Linux (Ubuntu/Debian)

#### Prerequisites
Install Qt6 development tools and dependencies:
```bash
sudo apt update
sudo apt install qt6-base-dev qt6-tools-dev qt6-tools-dev-tools build-essential
```

For Qt5 (alternative):
```bash
sudo apt install qtbase5-dev qt5-qmake qttools5-dev-tools build-essential
```

#### Compilation
1. Clone the repository:
```bash
git clone https://github.com/Fr3nchK1ss/Gribouillot.git
cd Gribouillot
```

2. Generate the Makefile with qmake:
```bash
qmake6 gribouillot.pro
# Or for Qt5: qmake gribouillot.pro
```

3. Compile the project:
```bash
make -j$(nproc)
```

4. Run the application:
```bash
./bin/gribouillot
```

### Windows

#### Prerequisites
1. Download and install Qt6 from the official website:
   - Visit https://www.qt.io/download-qt-installer
   - Download the Qt Online Installer
   - During installation, select Qt 6.x for your compiler (MinGW or MSVC)
   - Make sure to install Qt Creator (optional but recommended)

2. Install a C++ compiler:
   - **Option A - MinGW** (comes with Qt installer)
   - **Option B - Visual Studio** (download from Microsoft)

#### Compilation with Qt Creator (Recommended)
1. Open Qt Creator
2. Click "Open Project" and select `gribouillot.pro`
3. Configure the project with your installed Qt kit
4. Click the "Build" button (hammer icon) or press Ctrl+B
5. Click the "Run" button (green play icon) or press Ctrl+R

#### Compilation with Command Line
1. Open Qt command prompt (from Start Menu → Qt → Qt 6.x)

2. Navigate to the project directory:
```cmd
cd path\to\Gribouillot
```

3. Generate the Makefile:
```cmd
qmake gribouillot.pro
```

4. Compile:
   - For MinGW:
   ```cmd
   mingw32-make
   ```
   - For MSVC (Visual Studio):
   ```cmd
   nmake
   ```

5. Run the application:
```cmd
bin\gribouillot.exe
```

## Project Structure
- **Source files**: `*.cpp` files containing the implementation
- **Header files**: `*.h` files containing class declarations
- **UI files**: `*.ui` files for Qt Designer interface definitions
- **Resources**: `gribouillot.qrc` for application resources (icons, images)
- **Translations**: `gribouillot_fr.ts/qm` for French translation
- **Build output**: Executable is generated in the `bin/` directory

## Troubleshooting

### Linux
- If `qmake6` is not found, try `qmake` or `qmake-qt6`
- Make sure Qt XML module is installed: `sudo apt install libqt6xml6`

### Windows
- Make sure the Qt bin directory is in your PATH
- If you get "qmake: command not found", use the Qt command prompt
- For missing DLLs, copy them from Qt's bin directory or use `windeployqt`
