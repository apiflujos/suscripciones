#!/bin/bash

# =============================================================================
# ApiFlujos Design System - Script de Integración
# =============================================================================
# Este script extrae el CSS del design system y lo instala en tu proyecto
# =============================================================================

set -e

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Variables
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESIGN_SYSTEM_HTML="$SCRIPT_DIR/../apiflujos-design-system.html"
CSS_OUTPUT_DIR=""
CSS_OUTPUT_FILE=""
INCLUDE_JS=false
CREATE_TEMPLATE=false

# =============================================================================
# Funciones de Ayuda
# =============================================================================

print_logo() {
    echo -e "${BLUE}"
    echo "╔═══════════════════════════════════════════════════════════╗"
    echo "║     ApiFlujos Design System - Integración Automática      ║"
    echo "╚═══════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

show_help() {
    cat << EOF
Uso: $(basename "$0") [OPCIONES] <ruta-proyecto>

Extrae el CSS del ApiFlujos Design System y lo instala en tu proyecto.

ARGUMENTOS:
    ruta-proyecto         Ruta absoluta del proyecto donde instalar el design system

OPCIONES:
    -h, --help            Mostrar esta ayuda
    -o, --output <ruta>   Ruta personalizada para el archivo CSS
    -j, --with-js         Incluir script de inicialización de temas
    -t, --template        Crear plantilla HTML base
    -f, --force           Sobrescribir archivos existentes

EJEMPLOS:
    $(basename "$0") /var/www/mi-proyecto
    $(basename "$0") -o ./assets/css -j -t /var/www/mi-proyecto
    $(basename "$0") --output ./styles --with-js /var/www/mi-proyecto

EOF
}

# =============================================================================
# Funciones Principales
# =============================================================================

extract_css() {
    local html_file="$1"
    local output_file="$2"
    
    print_info "Extrayendo CSS desde: $html_file"
    
    # Verificar que el archivo HTML existe
    if [[ ! -f "$html_file" ]]; then
        print_error "No se encontró el archivo HTML: $html_file"
        exit 1
    fi
    
    # Extraer contenido entre <style> y </style>
    # Usamos sed para extraer todo el bloque style
    sed -n '/<style>/,/<\/style>/p' "$html_file" | \
        sed '1d;$d' | \
        sed 's/^[[:space:]]*//' > "$output_file"
    
    if [[ -s "$output_file" ]]; then
        print_success "CSS extraído correctamente: $output_file"
        print_info "Tamaño: $(wc -c < "$output_file") bytes"
    else
        print_error "Error al extraer el CSS"
        exit 1
    fi
}

create_js_initializer() {
    local output_dir="$1"
    local js_file="$output_dir/design-system-init.js"
    
    print_info "Creando script de inicialización..."
    
    cat > "$js_file" << 'JSEOF'
/**
 * ApiFlujos Design System - Inicializador
 * 
 * Este script maneja:
 * - Carga del tema guardado en localStorage
 * - Cambio dinámico de temas
 * - Inicialización de íconos Lucide
 */

(function() {
    'use strict';
    
    // Configuración
    const CONFIG = {
        defaultTheme: 'light',
        storageKey: 'theme',
        iconLibrary: 'lucide'
    };
    
    /**
     * Obtener tema guardado o usar default
     */
    function getSavedTheme() {
        try {
            return localStorage.getItem(CONFIG.storageKey) || CONFIG.defaultTheme;
        } catch (e) {
            console.warn('LocalStorage no disponible:', e);
            return CONFIG.defaultTheme;
        }
    }
    
    /**
     * Guardar tema en localStorage
     */
    function saveTheme(theme) {
        try {
            localStorage.setItem(CONFIG.storageKey, theme);
        } catch (e) {
            console.warn('No se pudo guardar el tema:', e);
        }
    }
    
    /**
     * Aplicar tema al documento
     */
    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        
        // Actualizar botones del theme selector
        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.theme === theme) {
                btn.classList.add('active');
            }
        });
    }
    
    /**
     * Inicializar íconos Lucide
     */
    function initializeIcons() {
        if (typeof lucide !== 'undefined' && lucide.createIcons) {
            lucide.createIcons();
        }
    }
    
    /**
     * Configurar event listeners para theme selector
     */
    function setupThemeSelector() {
        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                const theme = this.dataset.theme;
                applyTheme(theme);
                saveTheme(theme);
                initializeIcons();
            });
        });
    }
    
    /**
     * Inicialización principal
     */
    function init() {
        const theme = getSavedTheme();
        applyTheme(theme);
        
        // Esperar a que el DOM esté listo
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                setupThemeSelector();
                initializeIcons();
            });
        } else {
            setupThemeSelector();
            initializeIcons();
        }
    }
    
    // Ejecutar inicialización
    init();
    
    // Exponer funciones globalmente si es necesario
    window.ApiFlujosDS = {
        setTheme: function(theme) {
            applyTheme(theme);
            saveTheme(theme);
        },
        getTheme: function() {
            return getSavedTheme();
        },
        refreshIcons: initializeIcons
    };
    
})();
JSEOF
    
    print_success "Script JS creado: $js_file"
}

create_template() {
    local output_dir="$1"
    local template_file="$output_dir/template-base.html"
    
    print_info "Creando plantilla HTML base..."
    
    cat > "$template_file" << 'HTMLEOF'
<!DOCTYPE html>
<html lang="es" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ApiFlujos - Nueva Página</title>
  
  <!-- Favicon -->
  <link id="dynamic-favicon" rel="icon" type="image/svg+xml" href="assets/logos/isotipo_icono.svg">
  
  <!-- Fuentes Google -->
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
  
  <!-- Íconos Lucide -->
  <script src="https://unpkg.com/lucide@latest"></script>
  
  <!-- Design System CSS -->
  <link rel="stylesheet" href="styles/apiflujos-design-system.css">
  
  <!-- Estilos personalizados (opcional) -->
  <link rel="stylesheet" href="styles/custom.css">
</head>
<body>

  <!-- Header con Navegación -->
  <header class="container" style="padding-bottom: 1.5rem; border-bottom: 2px solid var(--border-soft); margin-bottom: 2rem;">
    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
      <h1 class="brand-title" style="margin: 0;">ApiFlujos <span>Nuevo Proyecto</span></h1>
      
      <!-- Theme Selector -->
      <div class="theme-selector">
        <button class="theme-btn active" data-theme="light">
          <i data-lucide="sun" style="width: 16px; height: 16px;"></i> Claro
        </button>
        <button class="theme-btn" data-theme="dark">
          <i data-lucide="moon" style="width: 16px; height: 16px;"></i> Oscuro
        </button>
        <button class="theme-btn" data-theme="high-contrast">
          <i data-lucide="contrast" style="width: 16px; height: 16px;"></i> Alto Contraste
        </button>
        <button class="theme-btn" data-theme="safe">
          <i data-lucide="eye" style="width: 16px; height: 16px;"></i> Accesibilidad
        </button>
      </div>
    </div>
  </header>

  <!-- Contenido Principal -->
  <main class="container">
    
    <!-- Sección de Ejemplo -->
    <section>
      <h2 class="section-title">Bienvenido</h2>
      
      <div class="component-grid">
        <!-- Card Estándar -->
        <div class="card">
          <h3 style="color: var(--text-heading); margin-bottom: 0.5rem;">Card Estándar</h3>
          <p style="color: var(--text-body);">Esta es una card con el estilo por defecto.</p>
          <button class="btn btn-primary" style="margin-top: 1rem;">
            <i data-lucide="check" style="width: 14px; height: 14px;"></i> Acción
          </button>
        </div>
        
        <!-- Card Lila -->
        <div class="card is-lilac">
          <h3 style="color: var(--text-heading); margin-bottom: 0.5rem;">Card en Lila</h3>
          <p style="color: var(--text-body);">Esta card tiene el estilo lila suave.</p>
          <button class="btn btn-primary" style="margin-top: 1rem;">
            <i data-lucide="star" style="width: 14px; height: 14px;"></i> Destacado
          </button>
        </div>
        
        <!-- Card con Estadística -->
        <div class="card is-lilac">
          <h3 style="color: var(--text-heading); margin-bottom: 0.5rem;">Estadística</h3>
          <p class="product-price" style="font-size: 2rem; margin: 1rem 0;">1,234</p>
          <span class="pill pill-success">
            <i data-lucide="trending-up" style="width: 12px; height: 12px;"></i> +15%
          </span>
        </div>
      </div>
    </section>
    
    <!-- Sección de Productos -->
    <section style="margin-top: 3rem;">
      <h2 class="section-title">Productos de Ejemplo</h2>
      
      <div class="product-grid">
        <div class="product-card">
          <div class="product-img">
            <i data-lucide="package" size="48"></i>
          </div>
          <div class="product-body">
            <div class="product-name">Producto Básico</div>
            <div class="product-price">$29.99</div>
            <div class="product-stock">
              <i data-lucide="check-circle" style="width: 14px; height: 14px;"></i>
              Stock: 100
            </div>
            <button class="btn btn-primary">
              <i data-lucide="shopping-cart" style="width: 14px; height: 14px;"></i>
              Añadir
            </button>
          </div>
        </div>
        
        <div class="product-card is-lilac">
          <div class="product-img">
            <i data-lucide="star" size="48"></i>
          </div>
          <div class="product-body">
            <div class="product-name">Producto Premium</div>
            <div class="product-price">$99.99</div>
            <div class="product-stock">
              <i data-lucide="check-circle" style="width: 14px; height: 14px;"></i>
              Stock: 50
            </div>
            <button class="btn btn-primary">
              <i data-lucide="shopping-cart" style="width: 14px; height: 14px;"></i>
              Añadir
            </button>
          </div>
        </div>
      </div>
    </section>
    
  </main>

  <!-- Footer -->
  <footer class="container" style="margin-top: 4rem; padding-top: 2rem; border-top: 1px solid var(--border-soft); text-align: center; color: var(--text-muted); font-size: 0.875rem;">
    <p>© 2024 ApiFlujos. Todos los derechos reservados.</p>
  </footer>

  <!-- Design System JS -->
  <script src="styles/design-system-init.js"></script>
  
  <!-- Scripts personalizados -->
  <script>
    // Tu código personalizado aquí
    console.log('ApiFlujos Design System cargado correctamente');
  </script>
  
</body>
</html>
HTMLEOF
    
    print_success "Plantilla creada: $template_file"
}

# =============================================================================
# Parseo de Argumentos
# =============================================================================

PROJECT_PATH=""
OUTPUT_PATH=""

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            exit 0
            ;;
        -o|--output)
            OUTPUT_PATH="$2"
            shift 2
            ;;
        -j|--with-js)
            INCLUDE_JS=true
            shift
            ;;
        -t|--template)
            CREATE_TEMPLATE=true
            shift
            ;;
        -f|--force)
            FORCE=true
            shift
            ;;
        -*)
            print_error "Opción desconocida: $1"
            show_help
            exit 1
            ;;
        *)
            PROJECT_PATH="$1"
            shift
            ;;
    esac
done

# =============================================================================
# Validaciones
# =============================================================================

if [[ -z "$PROJECT_PATH" ]]; then
    print_error "Debes especificar la ruta del proyecto"
    show_help
    exit 1
fi

if [[ ! -d "$PROJECT_PATH" ]]; then
    print_error "El directorio no existe: $PROJECT_PATH"
    exit 1
fi

# =============================================================================
# Ejecución Principal
# =============================================================================

print_logo

# Determinar ruta de salida CSS
if [[ -n "$OUTPUT_PATH" ]]; then
    CSS_OUTPUT_DIR="$OUTPUT_PATH"
else
    CSS_OUTPUT_DIR="$PROJECT_PATH/styles"
fi

CSS_OUTPUT_FILE="$CSS_OUTPUT_DIR/apiflujos-design-system.css"

# Crear directorio de salida
print_info "Creando directorio: $CSS_OUTPUT_DIR"
mkdir -p "$CSS_OUTPUT_DIR"

# Verificar si el archivo ya existe
if [[ -f "$CSS_OUTPUT_FILE" && -z "$FORCE" ]]; then
    print_warning "El archivo ya existe: $CSS_OUTPUT_FILE"
    read -p "¿Sobrescribir? (y/N): " confirm
    if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
        print_info "Operación cancelada"
        exit 0
    fi
fi

# Extraer CSS
extract_css "$DESIGN_SYSTEM_HTML" "$CSS_OUTPUT_FILE"

# Crear JS initializer si se solicitó
if [[ "$INCLUDE_JS" == true ]]; then
    create_js_initializer "$CSS_OUTPUT_DIR"
fi

# Crear plantilla si se solicitó
if [[ "$CREATE_TEMPLATE" == true ]]; then
    create_template "$PROJECT_PATH"
fi

# =============================================================================
# Resumen
# =============================================================================

echo ""
print_success "¡Instalación completada!"
echo ""
echo "Archivos creados:"
echo "  - $CSS_OUTPUT_FILE"
[[ "$INCLUDE_JS" == true ]] && echo "  - $CSS_OUTPUT_DIR/design-system-init.js"
[[ "$CREATE_TEMPLATE" == true ]] && echo "  - $PROJECT_PATH/template-base.html"
echo ""
print_info "Próximos pasos:"
echo "  1. Copia la plantilla a tu proyecto (si la creaste)"
echo "  2. Importa el CSS en tu HTML:"
echo "     <link rel=\"stylesheet\" href=\"styles/apiflujos-design-system.css\">"
echo "  3. (Opcional) Importa el JS:"
echo "     <script src=\"styles/design-system-init.js\"></script>"
echo "  4. ¡Comienza a usar los componentes!"
echo ""
print_info "Consulta README.md para más información"
