#!/bin/bash
# ─────────────────────────────────────────────────────────────────
#  Calendario Ciclismo — iOS App Setup
#
#  Este script genera el proyecto Xcode (.xcodeproj) usando XcodeGen
#  y resuelve las dependencias de Swift Package Manager.
#
#  Uso:
#    cd ios-app
#    chmod +x setup.sh
#    ./setup.sh
#
#  Requisitos:
#    - macOS con Xcode 26+ instalado (iOS 26 SDK)
#    - Homebrew (se instala XcodeGen automáticamente si no existe)
# ─────────────────────────────────────────────────────────────────

set -e

echo "╔═══════════════════════════════════════════════════╗"
echo "║  Calendario Ciclismo — iOS Setup                  ║"
echo "╚═══════════════════════════════════════════════════╝"
echo ""

# ── 1. Verificar que estamos en macOS ──────────────────────────
if [[ "$(uname)" != "Darwin" ]]; then
    echo "❌ Este script requiere macOS con Xcode instalado."
    exit 1
fi

# ── 2. Verificar Xcode ────────────────────────────────────────
if ! command -v xcodebuild &> /dev/null; then
    echo "❌ Xcode no encontrado. Instálalo desde la App Store."
    exit 1
fi

XCODE_VERSION=$(xcodebuild -version | head -1)
echo "✓ $XCODE_VERSION"

# ── 3. Instalar XcodeGen si no existe ─────────────────────────
if ! command -v xcodegen &> /dev/null; then
    echo ""
    echo "⏳ Instalando XcodeGen..."
    if command -v brew &> /dev/null; then
        brew install xcodegen
    else
        echo "❌ Homebrew no encontrado. Instálalo primero:"
        echo "   /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
        echo ""
        echo "   O instala XcodeGen manualmente:"
        echo "   https://github.com/yonaskolb/XcodeGen#installing"
        exit 1
    fi
fi

XCODEGEN_VERSION=$(xcodegen version 2>/dev/null || echo "desconocida")
echo "✓ XcodeGen $XCODEGEN_VERSION"

# ── 4. Verificar que project.yml existe ───────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -f "project.yml" ]]; then
    echo "❌ No se encontró project.yml en $(pwd)"
    exit 1
fi

# ── 5. Generar proyecto Xcode ─────────────────────────────────
echo ""
echo "⏳ Generando proyecto Xcode..."
xcodegen generate

if [[ ! -d "CalendarioCiclismo.xcodeproj" ]]; then
    echo "❌ Error al generar el proyecto."
    exit 1
fi

echo "✓ Proyecto generado: CalendarioCiclismo.xcodeproj"

# ── 6. Resolver dependencias SPM ──────────────────────────────
echo ""
echo "⏳ Resolviendo dependencias de Swift Package Manager..."
echo "   (supabase-swift — esto puede tardar 1-2 minutos la primera vez)"
xcodebuild -resolvePackageDependencies \
    -project CalendarioCiclismo.xcodeproj \
    -scheme CalendarioCiclismo \
    -quiet 2>/dev/null || {
    echo "⚠️  No se pudieron resolver las dependencias automáticamente."
    echo "   Se resolverán al abrir el proyecto en Xcode."
}

# ── 7. Listo ──────────────────────────────────────────────────
echo ""
echo "╔═══════════════════════════════════════════════════╗"
echo "║  ✅ ¡Proyecto listo!                              ║"
echo "╚═══════════════════════════════════════════════════╝"
echo ""
echo "  Abrir en Xcode:"
echo "    open CalendarioCiclismo.xcodeproj"
echo ""
echo "  O desde terminal:"
echo "    xcodebuild -project CalendarioCiclismo.xcodeproj \\"
echo "               -scheme CalendarioCiclismo \\"
echo "               -destination 'platform=iOS Simulator,name=iPhone 16' \\"
echo "               build"
echo ""

# ── 8. Preguntar si abrir Xcode ──────────────────────────────
read -p "¿Abrir en Xcode ahora? (s/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Ss]$ ]]; then
    open CalendarioCiclismo.xcodeproj
fi
