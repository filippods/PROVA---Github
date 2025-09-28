# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# 🚨 CRITICAL DEVELOPMENT GUIDELINES

## Development Principles
- **ONLY CORRECT WHAT NEEDS CORRECTION**: Do not modify working code unless there are genuine bugs or security issues
- **CORRECTIONS MUST BE RADICAL AND DEFINITIVE**: No patches or temporary fixes - solve problems completely
- **ALWAYS LIST MODIFIED FILES**: After any changes, provide a clear list of all modified files for easy tracking

## Code Quality Rules
- **Preserve Working Logic**: If functionality works correctly, keep the existing implementation
- **Maintain Backwards Compatibility**: Ensure changes don't break existing configurations or data

---

# PROJECT OVERVIEW

**Sistema di Irrigazione Automatica** - A sophisticated MicroPython-based irrigation control system for ESP32 microcontrollers featuring web management, automatic scheduling, zone control, and comprehensive error recovery.

**Target Platform**: ESP32/ESP8266 with MicroPython
**Architecture**: Async multi-task system with hardware integration
**Interface**: Web-based control panel with REST API

---

# EXECUTION COMMANDS

Since this is a MicroPython microcontroller project, there are no traditional build/test commands:

```python
# Main execution (upload to ESP32 and run)
python main.py

# Alternative entry points for development
python boot.py          # System bootstrap
python test_fix.py      # Import testing and diagnostics
```

**Deployment**: Upload all files to ESP32 filesystem, system auto-starts via boot.py

---

# SYSTEM ARCHITECTURE

## 🏗️ CORE MODULES

### **main.py** - System Orchestrator (369 lines)
- **Hardware Watchdog**: 90-second timeout with automatic feed
- **Multi-phase Startup**: Bluetooth disable → Safety reset → Hardware init → Network → Services
- **Error Recovery**: Consecutive error counting (max 5) with automatic reset
- **Memory Management**: Periodic garbage collection and optimization

### **boot.py** - System Bootstrap (29 lines)
- CPU frequency optimization (240MHz), memory setup, automatic main.py execution

## 🔧 ZONE MANAGEMENT

### **zone_manager.py** - Physical Zone Control (637 lines)
**Purpose**: Hardware abstraction for irrigation zones with state persistence

**Critical Data Structures**:
```python
active_zones = {}      # {zone_id: {'start_time': time, 'duration': minutes, 'manual': bool, 'task': task}}
zone_pins = {}         # {zone_id: Pin object}
safety_relay = None    # Master safety relay pin
```

**ESP32-S3 Pin Compatibility**:
- **Supported**: 1-8, 10-21 (GPIO pins)
- **Avoided**: 0,9 (boot), 19,20 (USB), 43,44 (flash)
- **Safety Relay**: Default GPIO 13

### **program_execution.py** - Program Runtime (263 lines)
**Design Philosophy**: Simplified execution logic delegating complexity to zone_manager
- Step sequencing, delay management, interruption handling, manual zone handling

### **program_scheduling.py** - Schedule Logic (281 lines)
- Recurrence types (daily, alternatingDays, custom intervals)
- Month selection, year boundary handling, legacy conversion

## 📦 PROGRAM MANAGEMENT

### **program_manager.py** - Program CRUD (335 lines)
- Atomic operations with temporary files for safe writes
- Conflict detection, legacy migration, cache management

### **program_state.py** - State Persistence (148 lines)
- Simple atomic file operations avoiding race conditions

## 🌐 NETWORK MANAGEMENT

### **wifi_manager.py** - Network Connectivity (741 lines)
**Complex Features**: Coexistence mode (AP + client), safe scanning, mDNS integration, automatic failover
⚠️ **Critical Code Complexity**: Highest technical debt due to complex state management and long functions

### **web_server.py** - HTTP Server (261 lines)
- Microdot framework, 2MB max content, unified error handling, file caching

## 🗄️ DATA MANAGEMENT

### **settings_manager.py** - Configuration Management (555 lines)
**Validation Framework**: Structure validation, type checking, migration support, factory reset

**Default Configuration**:
```python
default_settings = {
    'language': 'it', 'safety_relay': {'pin': 13},
    'zones': [{'id': 0, 'pin': 14, 'name': 'Giardino'}, ...],
    'automatic_programs_enabled': True, 'max_active_zones': 3,
    'wifi': {'ssid': '', 'password': ''}, 'activation_delay': 5, 'max_zone_duration': 180
}
```

### **log_manager.py** - System Logging (239 lines)
- Date-based rotation (10-day retention), write caching, size limits, level filtering

### **cache_manager.py** + **file_cache.py** - Caching (56 + 140 lines)
- TTL-based caching, LRU cache for web assets

## 🔌 API LAYER

### **api_handlers/** - REST API Implementation
- **zone_api.py** (317 lines): Zone diagnostics, ESP32-S3 pin testing, start/stop operations
- **program_api.py** (290 lines): Full CRUD, background task execution, conflict validation
- **wifi_api.py** (556 lines): Safe WiFi scanning, connection management, status monitoring
- **settings_api.py** (94 lines): Settings validation, factory reset
- **system_api.py** (158 lines): System restart, emergency stop, log download

## 🖥️ WEB INTERFACE

### **Core HTML Pages**:

#### **main.html** - SPA Master Container (2,211 lines)
**Complete Design System**: 7 semantic color categories, responsive breakpoints, shadow system
**Key Components**:
- **Real-time Program Overlay**: Full-screen modal with progress tracking
- **Status Banner**: Animated status with gradient backgrounds
- **Toast System**: 4 notification types with auto-dismiss
- **Navigation Router**: Page loading with history management

#### **manual.html** - Zone Control Interface (547 lines)
- Dynamic zone grid, circular progress rings (SVG), duration controls with steppers
- Real-time updates, card animations with hover effects

#### **settings.html** - System Configuration (889 lines)
**Card-Based Interface**: Language, WiFi (dual-mode), zones, advanced settings, system actions
- WiFi management with network scanning, zone configuration with pin validation
- Modal dialogs with staged confirmations

#### **Other Pages**: create_program.html, modify_program.html, view_programs.html
- Multi-step forms, validation systems, schedule configuration

### **JavaScript Architecture**:

#### **core.js** - JavaScript Framework (1,528 lines)
**Major Modules**:
- **IrrigationUtils**: Schedule formatting, datetime display, performance utilities
- **IrrigationI18n**: Dynamic language switching, key-based translation
- **IrrigationAPI**: HTTP client with retry logic, 15-second TTL cache
- **IrrigationRouter**: SPA router with module injection
- **IrrigationStatus**: Real-time monitoring with 5-second polling

#### **scripts.js** - Application Bootstrap (574 lines)
- Module loading system, error recovery, state management, event coordination

#### **Modular JavaScript** (web/js/modules/):
- **manual.js**: Real-time zone control with timer management
- **view_programs.js**: Program dashboard with status updates
- **create_program.js**: Multi-step form validation
- **modify_program.js**: Program editor with pre-population
- **settings.js**: System configuration interface

### **Internationalization**: **web/locales/**
- **Complete Coverage**: en.json, it.json, de.json, fr.json, es.json (258 lines each)
- **Key Categories**: Navigation, settings, manual control, programs, system messages
- **Advanced Features**: Variable substitution, hierarchical keys, validation messages

## 📊 DATA LAYER

### **data/** - Configuration and State Files
#### **Factory Settings**: **factory_settings.json** (21 lines)
- Default AP: SSID "IrrigaSmart", password "12345678"
- 8 zones with pin mappings (3, 46, 9-14), safety relay pin 40

#### **Runtime State Files**:
- **program.json**: Active program definitions
- **program_state.json**: Current execution state
- **user_settings.json**: User configuration overrides
- **system_log.json**: Structured event logging
- **wifi_scan.json**: Cached network scan results

## 📚 LIBRARY DEPENDENCIES

### **lib/** - Third-Party Libraries
- **microdot/**: Lightweight HTTP server framework optimized for MicroPython
- **asyncio/**: Enhanced async functionality for MicroPython compatibility

## 🧪 DEVELOPMENT TOOLS

### **test_fix.py** - Development Testing (77 lines)
- Import validation, startup simulation, error validation, debug information

### **diagnostics/system_monitor.py** - Health Monitoring (150 lines)
- Memory tracking, web server health, periodic status reporting

### **utils.py** - Common Functions (179 lines)
- Date/time calculations, filesystem utilities, garbage collection

---

# 🚨 CODE QUALITY ASSESSMENT

## ✅ STRENGTHS
- **Architecture**: Clear separation of concerns, robust error handling, state persistence
- **Reliability**: Atomic file operations, state recovery, error counting, memory management
- **Organization**: Modular design, consistent patterns, good documentation, legacy support

## ⚠️ CRITICAL ISSUES REQUIRING CORRECTION

### **1. Bare Exception Handling (29 occurrences)**
**Files**: wifi_manager.py, zone_manager.py, api_handlers/
**Problem**: `except:` statements catch ALL exceptions, hiding critical errors
**Fix Required**: Replace with specific exception types

### **2. Global State Management**
**Files**: program_execution.py, zone_manager.py, wifi_manager.py
**Problem**: Heavy reliance on global variables
**Risk**: Race conditions, state synchronization issues
**Critical Variables**: `active_zones`, `program_running`, `current_program_id`, `_wifi_status`

### **3. Complex Functions**
**Files**: wifi_manager.py, api_handlers/wifi_api.py
**Problem**: Functions exceeding 100 lines with multiple responsibilities
**Fix Required**: Break into focused sub-functions

### **4. Security Vulnerabilities**
- **Input Validation Gaps** (HIGH): Limited sanitization in API endpoints
- **No Authentication** (MEDIUM): Web interface lacks access control
- **Default Credentials** (MEDIUM): Hardcoded AP password "12345678"
- **File Path Handling** (LOW): Direct path construction without validation

### **5. Design Problems**
- **Circular Dependencies**: Multiple modules import each other
- **Mixed Abstraction Levels**: Hardware control mixed with high-level logic
- **Inconsistent Error Handling**: Different patterns across modules
- **Magic Numbers**: Hardcoded timeouts and thresholds throughout

---

# 🔧 CORRECTION GUIDELINES

## HIGH PRIORITY FIXES

### **1. Fix Bare Exception Handling**
```python
# Replace bare except with specific exceptions
try:
    operation()
except (OSError, ValueError) as e:
    log_event(f"Specific error: {e}", "ERROR")
except Exception as e:
    log_event(f"Unexpected error: {e}", "ERROR")
    import sys
    sys.print_exception(e)
```

### **2. Implement State Management Classes**
```python
class ProgramState:
    def __init__(self):
        self._running = False
        self._current_id = None
        self._lock = asyncio.Lock()

    async def set_running(self, program_id):
        async with self._lock:
            self._running = True
            self._current_id = program_id
            self._save_state()
```

### **3. Add Input Validation and Authentication**
```python
def validate_zone_id(zone_id):
    if not isinstance(zone_id, int) or zone_id < 0 or zone_id > 7:
        raise ValueError(f"Invalid zone ID: {zone_id}")
    return zone_id

@require_authentication
@validate_input
async def zone_endpoint(request):
    # Protected endpoint with validated input
```

### **4. Break Down Complex Functions**
```python
async def scan_wifi_networks():
    networks = await _perform_scan()
    processed = _process_scan_results(networks)
    await _save_scan_results(processed)
    return processed
```

## MEDIUM PRIORITY IMPROVEMENTS
1. **Externalize Configuration**: Move hardcoded constants to config.py
2. **Proper Logging Levels**: Remove excessive DEBUG logging
3. **Comprehensive Input Validation**: Validate all user inputs

---

# 🚨 MODIFICATION RULES

## **What TO Modify**:
1. Bare exception handlers → Specific exception types
2. Global state variables → State management classes
3. Missing input validation → Comprehensive sanitization
4. Security vulnerabilities → Authentication and validation
5. Functions >100 lines → Focused sub-functions
6. Hardcoded constants → Configuration files

## **What NOT TO Modify**:
1. **Working zone control logic** - Current implementation functions correctly
2. **Program execution flow** - Simplified approach works reliably
3. **File caching system** - Well-designed and appropriate
4. **Settings validation framework** - Comprehensive and robust
5. **Web interface structure** - Clean and functional design
6. **Async task management** - Proper concurrent task handling

## **Correction Standards**:
1. **Be Radical**: Fix problems completely, don't add patches
2. **Maintain Functionality**: Ensure existing features continue working
3. **Add Tests**: Include validation for corrections where possible
4. **Document Changes**: Update comments and docstrings
5. **Preserve Data**: Ensure changes don't break existing configurations

---

# 📋 MODIFIED FILES TRACKING

When making corrections, always provide a list of modified files in this format:

```
## Files Modified in This Session:
- wifi_manager.py: Fixed bare exception handling, broke down complex functions
- zone_manager.py: Replaced global state with proper state management
- api_handlers/zone_api.py: Added input validation and authentication
- settings_manager.py: Added new security configuration options
- main.py: Externalized hardcoded constants to config.py
```

---

# 📊 PROJECT STATISTICS

**Total Files**: 62 (36 Python, 7 HTML, 7 JavaScript, 11 JSON, 1 CSS)
**Lines of Code**: ~14,700 custom code + ~900 configuration
**Critical Metrics**: 39 global variables, 29 bare exceptions, 250+ translation keys, 40+ API endpoints

**Quality Scores**:
- **Maintainability**: 6.5/10 - Functional but needs architectural cleanup
- **Security**: 4/10 - Basic safety features but lacks proper security controls
- **Reliability**: 7.5/10 - Good error recovery and state management

**Overall Assessment**: Production-ready for trusted environments, requires security and architecture improvements for broader deployment.