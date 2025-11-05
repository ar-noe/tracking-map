// ========== CONFIGURACIÓN FIREBASE ==========
const firebaseConfig = {
    apiKey: "AIzaSyA8-3oTymLTSWMIBUJ5mFiZa821Px5i1qY",
    authDomain: "mapamatenme.firebaseapp.com",
    projectId: "mapamatenme",
    storageBucket: "mapamatenme.appspot.com",
    messagingSenderId: "318331967201",
    appId: "1:318331967201:web:91c602edcc512b8be549a0"
};

// Inicializar Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Configuración de MapBox
mapboxgl.accessToken = 'pk.eyJ1IjoiYXJ6bm9lIiwiYSI6ImNtZnN0amtreTBnODgya29mdjRseWk2Y3IifQ.jZS9TBpkEZ7EJ1dH2ZO0-A';

// ========== VARIABLES GLOBALES ==========
let map;
let markers = [];
let currentUserLocationMarker = null;
let locationsListener = null;
let currentLocationListener = null;
let geofencesListener = null;
let alertsListener = null;

let usuariosDisponibles = [];
let usuarioSeleccionado = null;
let currentUserRole = 'usuario';
let geocercas = [];
let alertas = [];

// Variables para creación de geocercas
let isCreatingGeofence = false;
let currentGeofenceType = null;
let geofencePoints = [];
let polygonPoints = [];
let geofenceMarker = null;
let geofenceCircle = null;
let polygonLine = null;
let polygonMarkers = [];

// Variables para control de teclado
let ctrlKeyPressed = false;
let originalMapInteractions = {};

// ========== FUNCIONES DE INICIALIZACIÓN ==========
function initializeApp() {
    initializeMap();
    setupAuthListener();
    setupKeyboardControls();
    addWebLocationButton();

    // Solo para admins
    if (currentUserRole === 'admin') {
        addFixMobileUsersButton();
    }
}

function initializeMap() {
    try {
        map = new mapboxgl.Map({
            container: 'map',
            style: 'mapbox://styles/mapbox/streets-v12',
            center: [0, 0],
            zoom: 12
        });

        map.addControl(new mapboxgl.NavigationControl());
        map.addControl(new mapboxgl.GeolocateControl({
            positionOptions: { enableHighAccuracy: true },
            trackUserLocation: true,
            showUserLocation: true
        }));

        document.getElementById('map').style.display = 'none';
        saveOriginalMapInteractions();

        // Evento click para geocercas
        map.on('click', (e) => {
            if (isCreatingGeofence && ctrlKeyPressed && currentUserRole === 'admin') {
                addGeofencePoint(e.lngLat);
                e.originalEvent.preventDefault();
                e.originalEvent.stopPropagation();
                return false;
            }
        });

        map.on('load', function() {
            if (map) {
                setTimeout(() => map.resize(), 100);
            }
        });

        window.addEventListener('resize', () => {
            if (map) {
                setTimeout(() => map.resize(), 100);
            }
        });
    } catch (error) {
        console.error('Error inicializando mapa:', error);
    }
}

// ========== CONTROL DE TECLADO ==========
function setupKeyboardControls() {
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Control' && !ctrlKeyPressed) {
            ctrlKeyPressed = true;
            if (isCreatingGeofence && currentUserRole === 'admin') {
                enableGeofenceCreationMode();
            }
        }
    });

    document.addEventListener('keyup', (e) => {
        if (e.key === 'Control' && ctrlKeyPressed) {
            ctrlKeyPressed = false;
            disableGeofenceCreationMode();
        }
    });

    window.addEventListener('blur', () => {
        if (ctrlKeyPressed) {
            ctrlKeyPressed = false;
            disableGeofenceCreationMode();
        }
    });
}

function enableGeofenceCreationMode() {
    if (map && map.getCanvas()) {
        map.getCanvas().style.cursor = 'crosshair';
    }
    disableMapInteractions();
    showTemporaryAlert('MODO CREACIÓN ACTIVADO\nMantén presionado CTRL y haz click en el mapa');
}

function disableGeofenceCreationMode() {
    console.log('Restaurando modo normal del mapa');
    if (map && map.getCanvas()) {
        map.getCanvas().style.cursor = '';
    }
    restoreMapInteractions();
}

function saveOriginalMapInteractions() {
    if (!map) return;
    originalMapInteractions = {
        scrollZoom: map.scrollZoom.isEnabled(),
        boxZoom: map.boxZoom.isEnabled(),
        dragRotate: map.dragRotate.isEnabled(),
        dragPan: map.dragPan.isEnabled(),
        keyboard: map.keyboard.isEnabled(),
        doubleClickZoom: map.doubleClickZoom.isEnabled(),
        touchZoomRotate: map.touchZoomRotate.isEnabled()
    };
}

function disableMapInteractions() {
    if (!map) return;
    map.scrollZoom.disable();
    map.boxZoom.disable();
    map.dragRotate.disable();
    map.dragPan.disable();
    map.keyboard.disable();
    map.doubleClickZoom.disable();
    map.touchZoomRotate.disable();
    console.log('Interacciones del mapa deshabilitadas');
}

function restoreMapInteractions() {
    if (!map) return;
    if (originalMapInteractions.scrollZoom) map.scrollZoom.enable();
    if (originalMapInteractions.boxZoom) map.boxZoom.enable();
    if (originalMapInteractions.dragRotate) map.dragRotate.enable();
    if (originalMapInteractions.dragPan) map.dragPan.enable();
    if (originalMapInteractions.keyboard) map.keyboard.enable();
    if (originalMapInteractions.doubleClickZoom) map.doubleClickZoom.enable();
    if (originalMapInteractions.touchZoomRotate) map.touchZoomRotate.enable();
    console.log('Interacciones del mapa restauradas');
}

// ========== SISTEMA DE MONITOREO PRINCIPAL ==========
function setupCurrentLocationListener() {
    const user = auth.currentUser;
    if (!user) return;

    // Limpiar listener anterior
    if (currentLocationListener) {
        currentLocationListener();
        currentLocationListener = null;
    }

    // Limpiar marcador
    if (currentUserLocationMarker) {
        currentUserLocationMarker.remove();
        currentUserLocationMarker = null;
    }

    let query;
    if (currentUserRole === 'admin' && usuarioSeleccionado) {
        console.log('Monitoreando usuario específico:', usuarioSeleccionado.nombre);
        query = db.collection("ubicaciones_actuales")
            .where("userId", "==", usuarioSeleccionado.id);
    } else if (currentUserRole === 'admin') {
        const usuariosIds = usuariosDisponibles.map(u => u.id);
        if (usuariosIds.length > 0) {
            query = db.collection("ubicaciones_actuales")
                .where("userId", "in", usuariosIds.slice(0, 10));
        } else {
            console.log('No hay usuarios disponibles para monitorear');
            return;
        }
    } else {
        query = db.collection("ubicaciones_actuales")
            .where("userId", "==", user.uid);
    }

    currentLocationListener = query.onSnapshot((querySnapshot) => {
        if (!querySnapshot.empty) {
            querySnapshot.forEach((doc) => {
                const locationData = doc.data();
                console.log('Ubicación recibida:', locationData);

                // Actualizar interfaz
                updateCurrentLocationOnMap(locationData);
                updateCurrentLocationInList(locationData);
                showRealTimeIndicator();

                checkGeofencesForLocation(locationData);
            });
        } else {
            console.log('No hay ubicación actual disponible');
            hideRealTimeIndicator();
            removeCurrentLocationMarker();
        }
    }, (error) => {
        console.error('Error en listener de ubicación:', error);
        hideRealTimeIndicator();
    });
}

function updateCurrentLocationOnMap(location) {
    const { latitud, longitud, direccion, timestamp } = location;

    // Remover marcador anterior si existe
    if (currentUserLocationMarker) {
        currentUserLocationMarker.remove();
    }

    // Crear elemento personalizado para el marcador
    const el = document.createElement('div');
    el.className = 'current-location-marker';
    el.style.width = '20px';
    el.style.height = '20px';
    el.style.backgroundColor = '#90b493';
    el.style.border = '3px solid #F7EEDD';
    el.style.borderRadius = '50%';
    el.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
    el.style.cursor = 'pointer';
    el.title = 'Ubicación actual';

    // Crear el marcador
    currentUserLocationMarker = new mapboxgl.Marker({
        element: el,
        color: '#2196f3'
    })
        .setLngLat([longitud, latitud])
        .setPopup(new mapboxgl.Popup({ offset: 25 })
            .setHTML(`
                <div class="geofence-popup">
                    <h4>Ubicación Actual</h4>
                    <p><strong>Usuario:</strong> ${usuarioSeleccionado ? usuarioSeleccionado.nombre : 'Tú'}</p>
                    <p><strong>Coordenadas:</strong> ${latitud.toFixed(6)}, ${longitud.toFixed(6)}</p>
                    <p><strong>Dirección:</strong> ${direccion || 'No disponible'}</p>
                    <p><strong>Última actualización:</strong> ${new Date().toLocaleTimeString()}</p>
                </div>
            `))
        .addTo(map);

    // Centrar el mapa en la nueva ubicación si es la primera vez
    if (!map.getCenter() || (currentUserRole === 'admin' && usuarioSeleccionado)) {
        map.flyTo({
            center: [longitud, latitud],
            zoom: 15,
            essential: true
        });
    }

    console.log('Marcador de ubicación actualizado en el mapa');
}

function updateCurrentLocationInList(location) {
    const { latitud, longitud, direccion, timestamp, deviceId, velocidad, precision } = location;

    const locationsList = document.getElementById('locations-list');
    const currentLocationElement = document.getElementById('current-location-item');

    const fecha = timestamp?.toDate ? timestamp.toDate() : new Date();

    const locationHTML = `
            <div class="location-item current-location-item" id="current-location-item">
                <div class="location-header">
                    <span class="location-number"></span>
                    <span class="current-location-badge">EN VIVO</span>
                </div>
                <div class="location-address">
                    <strong>Ubicación Actual</strong><br>
                    ${direccion || 'Ubicación en tiempo real'}
                </div>
                <div class="location-coords">
                    ${latitud.toFixed(6)}, ${longitud.toFixed(6)}
                </div>
                <div class="location-meta">
                    <span>${fecha.toLocaleDateString()} ${fecha.toLocaleTimeString()}</span>
                    <span>${deviceId ? deviceId.substring(0, 8) + '...' : 'Dispositivo'}</span>
                </div>
                ${velocidad ? `<div style="color: #666; font-size: 12px; margin-top: 5px;">
                    Velocidad: ${velocidad} km/h | Precisión: ${precision || 'N/A'}m
                </div>` : ''}
                <button onclick="flyToLocation(${longitud}, ${latitud})"
                        style="margin-top: 8px; padding: 5px 10px; background: #2196f3; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 12px;">
                    Centrar en mapa
                </button>
            </div>
        `;

    if (currentLocationElement) {
        currentLocationElement.outerHTML = locationHTML;
    } else {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = locationHTML;
        if (locationsList.firstChild) {
            locationsList.insertBefore(tempDiv.firstChild, locationsList.firstChild);
        } else {
            locationsList.appendChild(tempDiv.firstChild);
        }
    }
}

function showRealTimeIndicator() {
    const indicator = document.getElementById('realTimeIndicator');
    if (indicator) {
        indicator.style.display = 'inline-flex';
        indicator.textContent = '● EN VIVO';
    }
}

function hideRealTimeIndicator() {
    const indicator = document.getElementById('realTimeIndicator');
    if (indicator) {
        indicator.style.display = 'none';
    }
}

function removeCurrentLocationMarker() {
    if (currentUserLocationMarker) {
        currentUserLocationMarker.remove();
        currentUserLocationMarker = null;
        console.log('Marcador de ubicación removido');
    }
}

// ========== VERIFICACIÓN DE GEOCERCAS ==========
function checkGeofencesForLocation(locationData) {
    const { latitud, longitud, userId } = locationData;

    console.log(`Verificando geocercas para usuario: ${userId}`);
    console.log(`Ubicación: ${latitud}, ${longitud}`);
    console.log(`Total geocercas cargadas: ${geocercas.length}`);

    // Filtrar geocercas activas para este usuario
    const userGeofences = geocercas.filter(geocerca =>
        geocerca.activa && geocerca.usuarioId === userId
    );

    console.log(`Geocercas activas para este usuario: ${userGeofences.length}`);

    userGeofences.forEach(geocerca => {
        const isInside = checkIfLocationInsideGeofence(latitud, longitud, geocerca);
        const previousState = geocerca.lastState || 'unknown';

        console.log(`"${geocerca.nombre}": ${isInside ? 'DENTRO' : 'FUERA'} (anterior: ${previousState}) - Config: ${geocerca.alertaCuando}`);

        let shouldAlert = false;
        let eventType = '';

        if (geocerca.alertaCuando === 'dentro') {
            // Alertar cuando está DENTRO
            if (isInside && previousState !== 'inside') {
                shouldAlert = true;
                eventType = 'entrada_dentro';
            } else if (!isInside && previousState === 'inside') {
                shouldAlert = true;
                eventType = 'salida_dentro';
            }
        } else {
            // Alertar cuando está FUERA
            if (!isInside && previousState !== 'outside') {
                shouldAlert = true;
                eventType = 'salida_fuera';
            } else if (isInside && previousState === 'outside') {
                shouldAlert = true;
                eventType = 'entrada_fuera';
            }
        }

        if (shouldAlert) {
            console.log(`GENERANDO ALERTA: ${eventType} para "${geocerca.nombre}"`);
            handleGeofenceStateChange(geocerca, eventType, locationData);
        }

        // Actualizar estado
        geocerca.lastState = isInside ? 'inside' : 'outside';
    });
}

function checkIfLocationInsideGeofence(lat, lng, geocerca) {
    if (geocerca.tipo === 'circular') {
        const distance = calculateDistance(geocerca.centro.lat, geocerca.centro.lng, lat, lng);
        return distance <= geocerca.radio;
    } else if (geocerca.tipo === 'poligonal') {
        return checkIfInsidePolygonalGeofence(lat, lng, geocerca);
    }
    return false;
}

function checkIfInsidePolygonalGeofence(lat, lng, geocerca) {
    if (!geocerca.puntos || geocerca.puntos.length < 3) return false;

    const x = lng;
    const y = lat;
    let inside = false;

    for (let i = 0, j = geocerca.puntos.length - 1; i < geocerca.puntos.length; j = i++) {
        const xi = geocerca.puntos[i].lng;
        const yi = geocerca.puntos[i].lat;
        const xj = geocerca.puntos[j].lng;
        const yj = geocerca.puntos[j].lat;

        const intersect = ((yi > y) !== (yj > y)) &&
            (x < (xj - xi) * (y - yi) / (yj - yi) + xi);

        if (intersect) inside = !inside;
    }

    return inside;
}

function handleGeofenceStateChange(geocerca, eventType, locationData) {
    console.log(`🚨 ALERTA: ${eventType} en "${geocerca.nombre}"`);

    // Crear alerta en Firestore
    createGeofenceAlert(geocerca, eventType, locationData);

    // Mostrar notificación en tiempo real
    showGeofenceAlertNotification(geocerca, eventType, locationData);
}

function createGeofenceAlert(geocerca, eventType, locationData) {
    let tipoAlerta = '';
    let descripcion = '';

    if (eventType === 'entrada_dentro') {
        tipoAlerta = 'entrada_zona_controlada';
        descripcion = 'Usuario entró en zona controlada';
    } else if (eventType === 'salida_dentro') {
        tipoAlerta = 'salida_zona_controlada';
        descripcion = 'Usuario salió de zona controlada';
    } else if (eventType === 'salida_fuera') {
        tipoAlerta = 'salida_zona_permitida';
        descripcion = 'Usuario salió de zona permitida';
    } else if (eventType === 'entrada_fuera') {
        tipoAlerta = 'entrada_zona_permitida';
        descripcion = 'Usuario entró en zona permitida';
    }

    const alertData = {
        geocercaId: geocerca.id,
        geocercaNombre: geocerca.nombre,
        usuarioId: locationData.userId,
        usuarioNombre: usuarioSeleccionado ? usuarioSeleccionado.nombre : 'Usuario',
        administradorId: auth.currentUser.uid,
        tipo: tipoAlerta,
        descripcion: descripcion,
        configuracion: geocerca.alertaCuando,
        latitud: locationData.latitud,
        longitud: locationData.longitud,
        direccion: locationData.direccion || 'Ubicación no disponible',
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        leida: false
    };

     db.collection('alertas_geocercas').add(alertData)
            .then((docRef) => {
                console.log(`Alerta guardada: ${tipoAlerta} con ID: ${docRef.id}`);

                showGeofenceAlertNotification(geocerca, eventType, locationData, docRef.id);

                setTimeout(() => {
                    loadAlerts();
                }, 1000);
            })
            .catch((error) => {
                console.error('Error guardando alerta:', error);
            });
}

function showGeofenceAlertNotification(geocerca, eventType, locationData) {
    let icon, color, titulo, mensaje;

    if (eventType === 'entrada_dentro') {
        icon = 'ENTRADA';
        color = '#ff6b6b';
        titulo = 'ENTRADA EN ZONA CONTROLADA';
        mensaje = 'entró en una zona controlada';
    } else if (eventType === 'salida_dentro') {
        icon = 'SALIDA';
        color = '#ffa726';
        titulo = 'SALIDA DE ZONA CONTROLADA';
        mensaje = 'salió de una zona controlada';
    } else if (eventType === 'salida_fuera') {
        icon = '⚠ FUERA';
        color = '#f44336';
        titulo = 'SALIDA DE ZONA PERMITIDA';
        mensaje = 'salió de la zona permitida';
    } else if (eventType === 'entrada_fuera') {
        icon = 'REGRESO';
        color = '#4caf50';
        titulo = 'REGRESO A ZONA PERMITIDA';
        mensaje = 'regresó a la zona permitida';
    }

    const configuracion = geocerca.alertaCuando === 'dentro' ? 'DENTRO' : 'FUERA';

    const notificationHTML = `
        <div style="
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${color};
            color: white;
            padding: 15px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 2000;
            max-width: 350px;
            animation: slideInRight 0.3s ease-out;
        ">
            <div style="font-weight: bold; margin-bottom: 5px; font-size: 16px;">
                ${icon} ${titulo}
            </div>
            <div style="font-size: 14px; line-height: 1.4;">
                <strong>Geocerca:</strong> ${geocerca.nombre}<br>
                <strong>Usuario:</strong> ${usuarioSeleccionado ? usuarioSeleccionado.nombre : 'Tú'}<br>
                <strong>Evento:</strong> ${mensaje}<br>
                <strong>Configuración:</strong> Alertar cuando está ${configuracion}
            </div>
            <button onclick="this.parentElement.remove()"
                    style="margin-top: 10px; padding: 5px 12px; background: rgba(255,255,255,0.2); color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 12px;">
                Cerrar
            </button>
        </div>
    `;

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = notificationHTML;
    document.body.appendChild(tempDiv.firstChild);

    setTimeout(() => {
        if (tempDiv.firstChild && document.body.contains(tempDiv.firstChild)) {
            document.body.removeChild(tempDiv.firstChild);
        }
    }, 10000);

    // Añadir data-alert-id a la notificación
        notification.setAttribute('data-alert-id', alertId);

        // Actualizar el botón de cerrar para que también marque como leída
        notification.querySelector('button').onclick = function() {
            markAlertAsRead(alertId);
            this.parentElement.remove();
        };

}

// ========== CREACIÓN DE GEOCERCAS ==========
function startGeofenceCreation() {
    console.log('🚀 Iniciando creación de geocerca...', {
        currentUserRole,
        usuarioSeleccionado,
        isCreatingGeofence
    });

    if (currentUserRole !== 'admin') {
        alert('Solo los administradores pueden crear geocercas');
        return;
    }

    if (!usuarioSeleccionado) {
        alert('Primero selecciona un usuario para asignar la geocerca');
        showUserSelector();
        return;
    }

    showGeofenceTypeModal();
}

function showGeofenceTypeModal() {
    document.getElementById('geofenceTypeModal').style.display = 'flex';
}

function hideGeofenceTypeModal() {
    document.getElementById('geofenceTypeModal').style.display = 'none';
}

function selectGeofenceType(type) {
    console.log('🎯 Tipo de geocerca seleccionado:', type);
    currentGeofenceType = type;
    hideGeofenceTypeModal();

    isCreatingGeofence = true;
    geofencePoints = [];
    polygonPoints = [];

    // Limpiar cualquier elemento anterior del mapa
    if (geofenceMarker) {
        geofenceMarker.remove();
        geofenceMarker = null;
    }

    if (geofenceCircle) {
        if (map.getSource('geofence-circle')) {
            map.removeLayer('geofence-circle-fill');
            map.removeLayer('geofence-circle-border');
            map.removeSource('geofence-circle');
        }
        geofenceCircle = null;
    }

    // Actualizar interfaz
    updateGeofenceCreationUI(true);

    // Mostrar instrucciones
    if (type === 'circular') {
        showTemporaryAlert('🔵 MODO CÍRCULO ACTIVADO\nMantén presionado CTRL y haz click para establecer puntos');
    } else if (type === 'poligonal') {
        showTemporaryAlert('🟦 MODO POLÍGONO ACTIVADO\nMantén presionado CTRL y haz click para añadir puntos');
    }

    console.log('✅ Modo creación activado:', {
        isCreatingGeofence: isCreatingGeofence,
        currentGeofenceType: currentGeofenceType
    });
}

function addGeofencePoint(lngLat) {
    console.log('📍 addGeofencePoint llamado:', {
        isCreatingGeofence,
        currentGeofenceType,
        lngLat,
        geofencePoints,
        polygonPoints
    });

    if (!isCreatingGeofence || !currentGeofenceType) {
        console.log('❌ No está en modo creación o no hay tipo definido');
        return;
    }

    if (currentGeofenceType === 'circular') {
        console.log('🔵 Procesando punto para círculo');
        addCircularPoint(lngLat);
    } else if (currentGeofenceType === 'poligonal') {
        console.log('🟦 Procesando punto para polígono');
        addPolygonalPoint(lngLat);
    }
}

// ========== GEOCERCA CIRCULAR ==========
function addCircularPoint(lngLat) {
    console.log('⭕ addCircularPoint - Puntos actuales:', geofencePoints.length, 'Coordenadas:', lngLat);

    if (geofencePoints.length === 0) {
        // Primer click: centro
        geofencePoints.push(lngLat);
        console.log('✅ Centro establecido:', lngLat);

        // Crear marcador con color azul oscuro
        geofenceMarker = new mapboxgl.Marker({
            color: '#008DDA', // --azul-oscuro
            draggable: false
        })
            .setLngLat(lngLat)
            .setPopup(new mapboxgl.Popup().setHTML('<strong>Centro de la geocerca</strong><br>Mantén CTRL y haz click para el radio'))
            .addTo(map);

        showTemporaryAlert('CENTRO establecido. Mantén CTRL y haz click para el RADIO');

    } else if (geofencePoints.length === 1) {
        // Segundo click: radio
        const center = geofencePoints[0];
        const radius = calculateDistance(center.lat, center.lng, lngLat.lat, lngLat.lng);

        console.log('Radio calculado:', radius, 'metros');

        if (radius < 10) {
            alert('El radio debe ser de al menos 10 metros');
            return;
        }

        createGeofenceCircle(center, radius);
        showGeofenceConfirmationDialog(center, radius);
    }
}

function showGeofenceConfirmationDialog(center, radius) {
    console.log('📝 Mostrando modal de confirmación para círculo');

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Crear Geocerca Circular</h3>
                <p>Configura los detalles de la geocerca circular</p>
            </div>

            <div class="modal-input-group">
                <label for="circularGeofenceName">Nombre de la geocerca</label>
                <input type="text" id="circularGeofenceName" placeholder="Ej: Zona de Trabajo" >
                <div class="modal-help-text">Asigna un nombre descriptivo para identificar esta geocerca</div>
            </div>

            <div class="modal-input-group">
                <label for="circularGeofenceDescription">Descripción (opcional)</label>
                <textarea id="circularGeofenceDescription" placeholder="Ej: Área de trabajo principal del equipo"></textarea>
            </div>

            <div class="config-selector">
                <div class="config-option" onclick="selectConfigOption(this, 'fuera')">
                    <div class="config-icon fuera">1</div>
                    <div class="config-text">
                        <div class="config-title">Alertar cuando esté FUERA</div>
                        <div class="config-description">Recibir alertas cuando el usuario salga de esta zona</div>
                    </div>
                </div>
                <div class="config-option" onclick="selectConfigOption(this, 'dentro')">
                    <div class="config-icon dentro">2</div>
                    <div class="config-text">
                        <div class="config-title">Alertar cuando esté DENTRO</div>
                        <div class="config-description">Recibir alertas cuando el usuario entre en esta zona</div>
                    </div>
                </div>
            </div>

            <div class="geofence-info">
                <div class="geofence-info-item">
                    <span class="geofence-info-label">Radio:</span>
                    <span class="geofence-info-value">${radius.toFixed(2)} metros</span>
                </div>
                <div class="geofence-info-item">
                    <span class="geofence-info-label">Centro:</span>
                    <span class="geofence-info-value">${center.lat.toFixed(6)}, ${center.lng.toFixed(6)}</span>
                </div>
            </div>

            <div class="modal-buttons">
                <button class="modal-btn secondary" onclick="closeModal(this)">
                    <span>✕</span> Cancelar
                </button>
                <button class="modal-btn primary" onclick="confirmCircularGeofence(${center.lat}, ${center.lng}, ${radius})">
                    <span>✓</span> Crear Geocerca
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    // Seleccionar la primera opción por defecto
    selectConfigOption(modal.querySelector('.config-option'), 'fuera');
}

function selectConfigOption(element, value) {
    // Encontrar el contenedor padre del modal
    const modal = element.closest('.modal-content');
    if (!modal) return;

    // Remover selección anterior en este modal específico
    const configOptions = modal.querySelectorAll('.config-option');
    configOptions.forEach(opt => {
        opt.classList.remove('selected');
    });

    // Seleccionar nueva opción
    element.classList.add('selected');

    // Guardar el valor seleccionado en el elemento padre más cercano
    const configSelector = modal.querySelector('.config-selector');
    if (configSelector) {
        configSelector.setAttribute('data-selected', value);
    }

    // Asegurarse de que el valor se guarde también en una variable accesible
    element.closest('.modal-overlay').setAttribute('data-selected-config', value);
}

function confirmCircularGeofence(lat, lng, radius) {
    const modal = document.querySelector('.modal-overlay');
    if (!modal) {
        console.error('No se encontró el modal');
        return;
    }

    const nombre = modal.querySelector('#circularGeofenceName').value;
    const descripcion = modal.querySelector('#circularGeofenceDescription').value;

    // Obtener la configuración seleccionada correctamente
    const configSelector = modal.querySelector('.config-selector');
    const alertaCuando = configSelector ? configSelector.getAttribute('data-selected') : 'fuera';

    console.log('Datos del formulario:', { nombre, descripcion, alertaCuando });

    if (!nombre) {
        showTemporaryAlert('El nombre es obligatorio');
        return;
    }

    closeAllModals();

    // Crear la geocerca en Firestore
    crearGeocerca({
        nombre: nombre,
        descripcion: descripcion || '',
        tipo: 'circular',
        centro: { lat: lat, lng: lng },
        radio: radius,
        usuarioId: usuarioSeleccionado.id,
        administradorId: auth.currentUser.uid,
        alertaCuando: alertaCuando,
        activa: true
    });
}

function createGeofenceCircle(center, radius) {
    console.log('🔵 Creando círculo de geocerca:', { center, radius });

    // Limpiar círculo anterior si existe
    if (geofenceCircle) {
        if (map.getSource('geofence-circle')) {
            map.removeLayer('geofence-circle-fill');
            map.removeLayer('geofence-circle-border');
            map.removeSource('geofence-circle');
        }
    }

    // Crear círculo usando Turf.js
    const circle = turf.circle([center.lng, center.lat], radius / 1000, {
        steps: 64,
        units: 'kilometers'
    });

    map.addSource('geofence-circle', {
        type: 'geojson',
        data: circle
    });

    // Capa de relleno - celeste claro
    map.addLayer({
        id: 'geofence-circle-fill',
        type: 'fill',
        source: 'geofence-circle',
        paint: {
            'fill-color': '#ACE2E1', // --celeste-claro
            'fill-opacity': 0.3
        }
    });

    // Capa de borde - azul oscuro
    map.addLayer({
        id: 'geofence-circle-border',
        type: 'line',
        source: 'geofence-circle',
        paint: {
            'line-color': '#008DDA', // --azul-oscuro
            'line-width': 3
        }
    });

    geofenceCircle = circle;
    console.log('✅ Círculo de geocerca creado');
}

// ========== GEOCERCA POLIGONAL ==========
function addPolygonalPoint(lngLat) {
    console.log('🟦 addPolygonalPoint - Puntos actuales:', polygonPoints.length, 'Coordenadas:', lngLat);

    // Agregar punto al polígono
    polygonPoints.push(lngLat);
    console.log('Punto añadido al polígono. Total:', polygonPoints.length);

    // Crear marcador para el punto - color celeste
    const marker = new mapboxgl.Marker({
        color: '#41C9E2', // --celeste
        draggable: false
    })
        .setLngLat(lngLat)
        .setPopup(new mapboxgl.Popup().setHTML(`<strong>Punto ${polygonPoints.length}</strong><br>Coordenadas: ${lngLat.lat.toFixed(6)}, ${lngLat.lng.toFixed(6)}`))
        .addTo(map);

    polygonMarkers.push(marker);

    // Actualizar línea del polígono
    updatePolygonLine();

    // Mostrar instrucciones según cantidad de puntos
    if (polygonPoints.length === 1) {
        showTemporaryAlert('Primer punto establecido. Sigue añadiendo puntos con CTRL + Click');
    } else if (polygonPoints.length === 2) {
        showTemporaryAlert('Segundo punto añadido. Necesitas al menos 3 puntos');
    } else if (polygonPoints.length >= 3) {
        showTemporaryAlert(`${polygonPoints.length} puntos añadidos. Continúa o haz doble click para completar`);

        // Permitir completar el polígono con doble click
        setupPolygonDoubleClick();
    }
}

function setupPolygonDoubleClick() {
    // Configurar doble click para completar polígono
    map.once('dblclick', (e) => {
        if (isCreatingGeofence && currentGeofenceType === 'poligonal' && polygonPoints.length >= 3) {
            console.log('Doble click detectado - completando polígono');
            completePolygon();
        }
    });
}

function updatePolygonLine() {
    console.log('Actualizando línea del polígono. Puntos:', polygonPoints.length);

    // Remover línea anterior si existe
    if (polygonLine && map.getSource('polygon-line')) {
        map.removeLayer('polygon-line');
        map.removeSource('polygon-line');
    }

    if (polygonPoints.length < 2) {
        console.log('No hay suficientes puntos para la línea');
        return;
    }

    // Crear línea conectando los puntos
    const lineCoordinates = polygonPoints.map(point => [point.lng, point.lat]);
    console.log('Coordenadas de la línea:', lineCoordinates.length);

    map.addSource('polygon-line', {
        type: 'geojson',
        data: {
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: lineCoordinates
            }
        }
    });

    map.addLayer({
        id: 'polygon-line',
        type: 'line',
        source: 'polygon-line',
        paint: {
            'line-color': '#41C9E2', // --celeste
            'line-width': 3,
            'line-dasharray': [2, 1]
        }
    });

    polygonLine = 'polygon-line';
    console.log('✅ Línea del polígono actualizada');
}

function completePolygon() {
    console.log('🎯 Completando polígono. Puntos totales:', polygonPoints.length);

    if (polygonPoints.length < 3) {
        alert('Se necesitan al menos 3 puntos para crear un polígono.');
        return;
    }

    // Crear el polígono final
    createPolygonGeofence();
}

function createPolygonGeofence() {
    console.log('🟦 Creando geocerca poligonal definitiva');

    const polygonCoordinates = polygonPoints.map(point => [point.lng, point.lat]);
    // Cerrar el polígono añadiendo el primer punto al final
    polygonCoordinates.push(polygonCoordinates[0]);

    // Mostrar el polígono en el mapa temporalmente
    if (map.getSource('temp-polygon')) {
        map.removeLayer('temp-polygon-fill');
        map.removeLayer('temp-polygon-border');
        map.removeSource('temp-polygon');
    }

    map.addSource('temp-polygon', {
        type: 'geojson',
        data: {
            type: 'Feature',
            geometry: {
                type: 'Polygon',
                coordinates: [polygonCoordinates]
            }
        }
    });

    map.addLayer({
        id: 'temp-polygon-fill',
        type: 'fill',
        source: 'temp-polygon',
        paint: {
            'fill-color': '#ACE2E1',
            'fill-opacity': 0.3
        }
    });

    map.addLayer({
        id: 'temp-polygon-border',
        type: 'line',
        source: 'temp-polygon',
        paint: {
            'line-color': '#008DDA',
            'line-width': 3
        }
    });

    // Mostrar diálogo de confirmación
    showPolygonConfirmationDialog(polygonPoints);
}

function showPolygonConfirmationDialog(points) {
    console.log('📝 Mostrando modal de confirmación para polígono');

    const area = calculatePolygonArea(points);

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Crear Geocerca Poligonal</h3>
                <p style="color: #666; font-size: 12px; margin-top: 5px;">
                    Puntos: ${points.length} | Área: ${area.toFixed(2)} m²
                </p>
            </div>
            <div class="modal-input-group">
                <label for="polygonGeofenceName">Nombre de la geocerca:</label>
                <input type="text" id="polygonGeofenceName" placeholder="Ej: Área de Seguridad" >
            </div>
            <div class="modal-input-group">
                <label for="polygonGeofenceDescription">Descripción (opcional):</label>
                <textarea id="polygonGeofenceDescription" placeholder="Ej: Zona de seguridad perimetral"></textarea>
            </div>

            <div class="config-selector">
                <div class="config-option" onclick="selectConfigOption(this, 'fuera')">
                    <div class="config-icon fuera">1</div>
                    <div class="config-text">
                        <div class="config-title">Alertar cuando esté FUERA</div>
                        <div class="config-description">Recibir alertas cuando el usuario salga de esta zona</div>
                    </div>
                </div>
                <div class="config-option" onclick="selectConfigOption(this, 'dentro')">
                    <div class="config-icon dentro">2</div>
                    <div class="config-text">
                        <div class="config-title">Alertar cuando esté DENTRO</div>
                        <div class="config-description">Recibir alertas cuando el usuario entre en esta zona</div>
                    </div>
                </div>
            </div>

            <div class="modal-buttons">
                <button class="modal-btn secondary" onclick="closeModal(this)">Cancelar</button>
                <button class="modal-btn primary" onclick="confirmPolygonalGeofence(${JSON.stringify(points).replace(/"/g, '&quot;')})">Crear Geocerca</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    // Seleccionar la primera opción por defecto
    selectConfigOption(modal.querySelector('.config-option'), 'fuera');
}

function confirmPolygonalGeofence(points) {
    const modal = document.querySelector('.modal-overlay');
    if (!modal) {
        console.error('No se encontró el modal');
        return;
    }

    const nombre = modal.querySelector('#polygonGeofenceName').value;
    const descripcion = modal.querySelector('#polygonGeofenceDescription').value;

    // Obtener la configuración seleccionada correctamente
    const configSelector = modal.querySelector('.config-selector');
    const alertaCuando = configSelector ? configSelector.getAttribute('data-selected') : 'fuera';

    console.log('📝 Datos del formulario poligonal:', { nombre, descripcion, alertaCuando });

    if (!nombre) {
        showTemporaryAlert('El nombre es obligatorio');
        return;
    }

    closeAllModals();

    const area = calculatePolygonArea(points);

    // Crear la geocerca en Firestore
    crearGeocercaPoligonal({
        nombre: nombre,
        descripcion: descripcion || `Geocerca poligonal de ${points.length} puntos - Área: ${area.toFixed(2)} m²`,
        tipo: 'poligonal',
        puntos: points.map(p => ({ lat: p.lat, lng: p.lng })),
        usuarioId: usuarioSeleccionado.id,
        administradorId: auth.currentUser.uid,
        alertaCuando: alertaCuando,
        activa: true,
        area: area
    });
}

function crearGeocercaPoligonal(geocercaData) {
    console.log('Guardando geocerca poligonal en Firebase:', geocercaData);

    db.collection('geocercas').add({
        ...geocercaData,
        fechaCreacion: firebase.firestore.FieldValue.serverTimestamp(),
        fechaActualizacion: firebase.firestore.FieldValue.serverTimestamp()
    })
        .then((docRef) => {
            console.log('Geocerca poligonal creada con ID:', docRef.id);
            alert(`Geocerca poligonal creada exitosamente\n\nConfiguración: Alertar cuando el usuario esté ${geocercaData.alertaCuando.toUpperCase()} de la zona`);
            resetGeofenceCreation();
            loadGeofences();
        })
        .catch((error) => {
            console.error('Error creando geocerca poligonal:', error);
            alert('Error al crear geocerca: ' + error.message);
            resetGeofenceCreation();
        });
}

function crearGeocerca(geocercaData) {
    console.log('Guardando geocerca circular en Firebase:', geocercaData);

    db.collection('geocercas').add({
        ...geocercaData,
        fechaCreacion: firebase.firestore.FieldValue.serverTimestamp(),
        fechaActualizacion: firebase.firestore.FieldValue.serverTimestamp()
    })
        .then((docRef) => {
            console.log('Geocerca circular creada con ID:', docRef.id);
            alert(`Geocerca creada exitosamente\n\nConfiguración: Alertar cuando el usuario esté ${geocercaData.alertaCuando.toUpperCase()} de la zona`);
            resetGeofenceCreation();
            loadGeofences();
        })
        .catch((error) => {
            console.error('Error creando geocerca:', error);
            alert('Error al crear geocerca: ' + error.message);
            resetGeofenceCreation();
        });
}

// ========== FUNCIONES AUXILIARES ==========
function showTemporaryAlert(message) {

    const alertDiv = document.createElement('div');
    alertDiv.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: #f5f5f5;
        color: #4b514a;
        padding: 10px 20px;
        border-radius: 5px;
        z-index: 2000;
        font-size: 14px;
        max-width: 80%;
        text-align: center;
        border-left: 4px solid #A1E3F9;
        white-space: pre-line;
    `;
    alertDiv.textContent = message;
    document.body.appendChild(alertDiv);

    setTimeout(() => {
        if (document.body.contains(alertDiv)) {
            document.body.removeChild(alertDiv);
        }
    }, 4000);
}

function cancelGeofenceCreation() {
    console.log('Cancelando creación de geocerca');
    resetGeofenceCreation();
    showTemporaryAlert('Creación de geocerca cancelada');
}

function updateGeofenceCreationUI(creating) {
    const createBtn = document.getElementById('createGeofenceBtn');
    if (!createBtn) return;

    if (creating) {
        createBtn.style.backgroundColor = '#728370';
        createBtn.textContent = 'Cancelar Creación';
        createBtn.onclick = cancelGeofenceCreation;
        createBtn.classList.add('creating-mode');
    } else {
        createBtn.style.backgroundColor = '#728370';
        createBtn.textContent = 'Crear Geocerca';
        createBtn.onclick = startGeofenceCreation;
        createBtn.classList.remove('creating-mode');
    }
}

function resetGeofenceCreation() {
    console.log('Reseteando creación de geocerca');

    isCreatingGeofence = false;
    currentGeofenceType = null;
    geofencePoints = [];
    polygonPoints = [];

    // RESTAURAR CURSOR NORMAL
    if (map && map.getCanvas()) {
        map.getCanvas().style.cursor = '';
    }

    // Limpiar marcadores circulares
    if (geofenceMarker) {
        geofenceMarker.remove();
        geofenceMarker = null;
    }

    // Limpiar círculo
    if (geofenceCircle) {
        if (map.getSource('geofence-circle')) {
            map.removeLayer('geofence-circle-fill');
            map.removeLayer('geofence-circle-border');
            map.removeSource('geofence-circle');
        }
        geofenceCircle = null;
    }

    // Limpiar polígono temporal
    if (map.getSource('temp-polygon')) {
        map.removeLayer('temp-polygon-fill');
        map.removeLayer('temp-polygon-border');
        map.removeSource('temp-polygon');
    }

    // Limpiar línea de polígono
    if (polygonLine && map.getSource('polygon-line')) {
        map.removeLayer('polygon-line');
        map.removeSource('polygon-line');
        polygonLine = null;
    }

    // Limpiar marcadores de polígono
    polygonMarkers.forEach(marker => {
        if (marker) marker.remove();
    });
    polygonMarkers = [];

    // Resetear interfaz
    updateGeofenceCreationUI(false);

    console.log('Creación de geocerca completamente reseteada');
}

// ========== CÁLCULOS ==========
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Radio de la Tierra en metros
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    return Math.round(distance * 100) / 100; // Redondear a 2 decimales
}

function calculatePolygonArea(points) {
    if (points.length < 3) return 0;

    let area = 0;
    const n = points.length;

    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area += points[i].lng * points[j].lat;
        area -= points[j].lng * points[i].lat;
    }

    area = Math.abs(area) / 2;

    // Convertir grados cuadrados a metros cuadrados (aproximación)
    const areaInMeters = area * 111319.9 * 111319.9;

    return Math.round(areaInMeters);
}

// ========== GESTIÓN DE GEOCERCAS ==========
function showGeofenceManagement() {
    if (currentUserRole !== 'admin') {
        alert('Solo los administradores pueden gestionar geocercas');
        return;
    }
    document.getElementById('geofencesPanel').style.display = 'flex';
    updateGeofencesPanel();
}

function hideGeofencesPanel() {
    document.getElementById('geofencesPanel').style.display = 'none';
}

function showGeofenceAlerts() {
    if (currentUserRole !== 'admin') {
        alert('Solo los administradores pueden ver alertas');
        return;
    }
    document.getElementById('alertsPanel').style.display = 'flex';
    updateAlertsPanel();
}

function hideAlertsPanel() {
    document.getElementById('alertsPanel').style.display = 'none';
}

function loadGeofences() {
    if (currentUserRole !== 'admin') return;

    if (geofencesListener) {
        geofencesListener();
    }

    console.log('Cargando geocercas desde Firestore...');

    geofencesListener = db.collection('geocercas')
        .where('administradorId', '==', auth.currentUser.uid)
        .onSnapshot((querySnapshot) => {
            geocercas = [];
            querySnapshot.forEach((doc) => {
                const data = doc.data();
                geocercas.push({
                    id: doc.id,
                    ...data
                });
                console.log(`Geocerca cargada: ${data.nombre} (${data.tipo}) - Alerta cuando: ${data.alertaCuando}`);
            });
            console.log(`${geocercas.length} geocercas cargadas correctamente`);
            renderGeofencesOnMap();
            updateGeofencesPanel();

            // INICIAR MONITOREO SI HAY GEOCERCAS
            if (geocercas.length > 0) {
                console.log('Geocercas listas para monitoreo');
            }
        }, (error) => {
            console.error('Error cargando geocercas:', error);
        });
}

function renderGeofencesOnMap() {
    console.log('Renderizando geocercas en el mapa:', geocercas.length);

    // Limpiar geocercas anteriores del mapa
    clearGeofencesFromMap();

    geocercas.forEach((geocerca, index) => {
        if (geocerca.activa) {
            if (geocerca.tipo === 'circular') {
                renderCircularGeofence(geocerca);
            } else if (geocerca.tipo === 'poligonal') {
                renderPolygonalGeofence(geocerca);
            }
        }
    });
}

function clearGeofencesFromMap() {
    const sourcesToRemove = [];
    const layersToRemove = [];

    if (map.getStyle()) {
        map.getStyle().layers?.forEach(layer => {
            if (layer.id.includes('geofence-') || layer.id.includes('rendered-')) {
                layersToRemove.push(layer.id);
            }
        });

        Object.keys(map.getStyle().sources || {}).forEach(source => {
            if (source.includes('geofence-') || source.includes('rendered-')) {
                sourcesToRemove.push(source);
            }
        });
    }

    layersToRemove.forEach(layerId => {
        if (map.getLayer(layerId)) {
            map.removeLayer(layerId);
        }
    });

    sourcesToRemove.forEach(sourceId => {
        if (map.getSource(sourceId)) {
            map.removeSource(sourceId);
        }
    });
}

function renderCircularGeofence(geocerca) {
    const sourceId = `rendered-geofence-${geocerca.id}`;
    const fillLayerId = `${sourceId}-fill`;
    const borderLayerId = `${sourceId}-border`;

    try {
        const circle = turf.circle(
            [geocerca.centro.lng, geocerca.centro.lat],
            geocerca.radio / 1000,
            { steps: 64, units: 'kilometers' }
        );

        if (map.getSource(sourceId)) {
            map.removeLayer(fillLayerId);
            map.removeLayer(borderLayerId);
            map.removeSource(sourceId);
        }

        map.addSource(sourceId, {
            type: 'geojson',
            data: circle
        });

        map.addLayer({
            id: fillLayerId,
            type: 'fill',
            source: sourceId,
            paint: {
                'fill-color': '#ACE2E1',
                'fill-opacity': 0.2
            }
        });

        map.addLayer({
            id: borderLayerId,
            type: 'line',
            source: sourceId,
            paint: {
                'line-color': '#008DDA',
                'line-width': 2
            }
        });

        // Agregar marcador en el centro
        const marker = new mapboxgl.Marker({
            color: '#41C9E2'
        })
            .setLngLat([geocerca.centro.lng, geocerca.centro.lat])
            .setPopup(new mapboxgl.Popup().setHTML(`
    <div class="geofence-popup">
        <h4>${geocerca.nombre}</h4>
        <p><strong>Tipo:</strong> ${geocerca.tipo}</p>
        <p><strong>Configuración:</strong> Alertar cuando está <strong>${geocerca.alertaCuando.toUpperCase()}</strong> de la zona</p>
        <p><strong>Estado:</strong> ${geocerca.activa ? 'Activa' : 'Inactiva'}</p>
        <button onclick="deleteGeofence('${geocerca.id}')" style="background: #f44336; color: white; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer; margin-top: 5px;">
            Eliminar
        </button>
    </div>
`))
            .addTo(map);

        markers.push(marker);

    } catch (error) {
        console.error('Error renderizando geocerca circular:', error);
    }
}

function renderPolygonalGeofence(geocerca) {
    const sourceId = `rendered-geofence-${geocerca.id}`;
    const fillLayerId = `${sourceId}-fill`;
    const borderLayerId = `${sourceId}-border`;

    try {
        const coordinates = geocerca.puntos.map(p => [p.lng, p.lat]);
        coordinates.push(coordinates[0]); // Cerrar el polígono

        const polygon = {
            type: 'Feature',
            geometry: {
                type: 'Polygon',
                coordinates: [coordinates]
            }
        };

        if (map.getSource(sourceId)) {
            map.removeLayer(fillLayerId);
            map.removeLayer(borderLayerId);
            map.removeSource(sourceId);
        }

        map.addSource(sourceId, {
            type: 'geojson',
            data: polygon
        });

        map.addLayer({
            id: fillLayerId,
            type: 'fill',
            source: sourceId,
            paint: {
                'fill-color': '#ACE2E1',
                'fill-opacity': 0.2
            }
        });

        map.addLayer({
            id: borderLayerId,
            type: 'line',
            source: sourceId,
            paint: {
                'line-color': '#008DDA',
                'line-width': 2
            }
        });

        // Agregar marcador en el centroide
        const center = calculatePolygonCenter(geocerca.puntos);
        const marker = new mapboxgl.Marker({
            color: '#41C9E2'
        })
            .setLngLat([center.lng, center.lat])
            .setPopup(new mapboxgl.Popup().setHTML(`
    <div class="geofence-popup">
        <h4>${geocerca.nombre}</h4>
        <p><strong>Tipo:</strong> ${geocerca.tipo}</p>
        <p><strong>Configuración:</strong> Alertar cuando está <strong>${geocerca.alertaCuando.toUpperCase()}</strong> de la zona</p>
        <p><strong>Estado:</strong> ${geocerca.activa ? 'Activa' : 'Inactiva'}</p>
        <button onclick="deleteGeofence('${geocerca.id}')" style="background: #f44336; color: white; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer; margin-top: 5px;">
            Eliminar
        </button>
    </div>
    `))
            .addTo(map);

        markers.push(marker);

    } catch (error) {
        console.error('Error renderizando geocerca poligonal:', error);
    }
}

function calculatePolygonCenter(points) {
    let sumLng = 0;
    let sumLat = 0;

    points.forEach(point => {
        sumLng += point.lng;
        sumLat += point.lat;
    });

    return {
        lng: sumLng / points.length,
        lat: sumLat / points.length
    };
}

function updateGeofencesPanel() {
    const geofencesList = document.getElementById('geofences-list');
    if (!geofencesList) return;

    if (geocercas.length === 0) {
        geofencesList.innerHTML = '<div class="loading">No hay geocercas creadas</div>';
        return;
    }

    geofencesList.innerHTML = geocercas.map(geocerca => `
        <div class="geofence-item">
            <div class="geofence-header">
                <span class="geofence-name">${geocerca.nombre}</span>
                <span class="geofence-status ${geocerca.activa ? 'active' : 'inactive'}">
                    ${geocerca.activa ? 'ACTIVA' : 'INACTIVA'}
                </span>
            </div>
            <div class="geofence-details">
                <p><strong>Tipo:</strong> ${geocerca.tipo}</p>
                <p><strong>Usuario:</strong> ${geocerca.usuarioId}</p>
                <p><strong>Configuración:</strong> <span style="color: ${geocerca.alertaCuando === 'dentro' ? '#ff6b6b' : '#4caf50'}; font-weight: bold;">
                    Alertar cuando está ${geocerca.alertaCuando.toUpperCase()} de la zona
                </span></p>
                ${geocerca.tipo === 'circular' ?
            `<p><strong>Radio:</strong> ${geocerca.radio} m</p>` :
            `<p><strong>Puntos:</strong> ${geocerca.puntos ? geocerca.puntos.length : 'N/A'}</p>`
        }
                <p><strong>Creado:</strong> ${geocerca.fechaCreacion?.toDate?.().toLocaleDateString() || 'N/A'}</p>
            </div>
            <div class="geofence-actions">
                <button onclick="toggleGeofence('${geocerca.id}', ${!geocerca.activa})"
                        class="${geocerca.activa ? 'deactivate' : 'activate'}">
                    ${geocerca.activa ? 'Desactivar' : 'Activar'}
                </button>
                <button onclick="editGeofenceConfig('${geocerca.id}')"
                        class="edit"
                        style="background: #ffa726;">
                    Cambiar Configuración
                </button>
                <button onclick="deleteGeofence('${geocerca.id}')" class="delete">
                    Eliminar
                </button>
                <button onclick="flyToGeofence('${geocerca.id}')" class="view">
                    Ver en mapa
                </button>
            </div>
        </div>
    `).join('');
}

function editGeofenceConfig(geocercaId) {
    const geocerca = geocercas.find(g => g.id === geocercaId);
    if (!geocerca) return;

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>⚙️ Configurar Geocerca</h3>
                <p>Cambiar el comportamiento de alertas para "${geocerca.nombre}"</p>
            </div>

            <div class="config-selector">
                <div class="config-option ${geocerca.alertaCuando === 'fuera' ? 'selected' : ''}"
                     onclick="selectConfigOption(this, 'fuera')">
                    <div class="config-icon fuera">1</div>
                    <div class="config-text">
                        <div class="config-title">Alertar cuando esté FUERA</div>
                        <div class="config-description">Recibir alertas cuando el usuario salga de esta zona</div>
                    </div>
                </div>
                <div class="config-option ${geocerca.alertaCuando === 'dentro' ? 'selected' : ''}"
                     onclick="selectConfigOption(this, 'dentro')">
                    <div class="config-icon dentro">2</div>
                    <div class="config-text">
                        <div class="config-title">Alertar cuando esté DENTRO</div>
                        <div class="config-description">Recibir alertas cuando el usuario entre en esta zona</div>
                    </div>
                </div>
            </div>

            <div class="geofence-info">
                <div class="geofence-info-item">
                    <span class="geofence-info-label">Geocerca:</span>
                    <span class="geofence-info-value">${geocerca.nombre}</span>
                </div>
                <div class="geofence-info-item">
                    <span class="geofence-info-label">Tipo:</span>
                    <span class="geofence-info-value">${geocerca.tipo}</span>
                </div>
                <div class="geofence-info-item">
                    <span class="geofence-info-label">Configuración actual:</span>
                    <span class="geofence-info-value">${geocerca.alertaCuando.toUpperCase()}</span>
                </div>
            </div>

            <div class="modal-buttons">
                <button class="modal-btn secondary" onclick="closeModal(this)">
                    <span>✕</span> Cancelar
                </button>
                <button class="modal-btn primary" onclick="saveGeofenceConfig('${geocercaId}')">
                    <span>✓</span> Guardar Cambios
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    modal.setAttribute('data-selected', geocerca.alertaCuando);
}

function saveGeofenceConfig(geocercaId) {
    const modal = document.querySelector('.modal-overlay');
    if (!modal) {
        console.error('No se encontró el modal');
        return;
    }

    // Obtener la configuración seleccionada del modal
    const configSelector = modal.querySelector('.config-selector');
    const nuevaConfig = configSelector ? configSelector.getAttribute('data-selected') : 'fuera';

    if (!nuevaConfig) {
        showTemporaryAlert('Por favor selecciona una configuración');
        return;
    }

    closeAllModals();

    db.collection('geocercas').doc(geocercaId).update({
        alertaCuando: nuevaConfig,
        fechaActualizacion: firebase.firestore.FieldValue.serverTimestamp()
    })
    .then(() => {
        showTemporaryAlert(`Configuración actualizada:\n\nAhora se alertará cuando el usuario esté ${nuevaConfig.toUpperCase()} de la zona`);
        loadGeofences(); // Recargar las geocercas para reflejar el cambio
    })
    .catch((error) => {
        showTemporaryAlert('Error actualizando configuración: ' + error.message);
    });
}

// Función para cerrar modales
function closeModal(element) {
    const modal = element.closest('.modal-overlay');
    if (modal) {
        modal.remove();
    }
}

// Función para cerrar todos los modales
function closeAllModals() {
    document.querySelectorAll('.modal-overlay').forEach(modal => {
        modal.remove();
    });
}

// Cerrar modal al hacer click fuera del contenido
document.addEventListener('click', function(e) {
    if (e.target.classList.contains('modal-overlay')) {
        e.target.remove();
    }
});

// Cerrar modal con tecla ESC
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        closeAllModals();
    }
});

function deleteGeofence(geocercaId) {
    const geocerca = geocercas.find(g => g.id === geocercaId);
    if (!geocerca) return;

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content confirmation-modal">
            <div class="confirmation-icon"></div>
            <div class="confirmation-message">¿Eliminar geocerca?</div>
            <div class="confirmation-details">
                Estás a punto de eliminar la geocerca <strong>"${geocerca.nombre}"</strong>.
                Esta acción no se puede deshacer y se perderán todas las alertas asociadas.
            </div>
            <div class="modal-buttons">
                <button class="modal-btn secondary" onclick="closeModal(this)">
                    <span>✕</span> Conservar
                </button>
                <button class="modal-btn danger" onclick="confirmDeleteGeofence('${geocercaId}')">
                    <span></span> Eliminar
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
}


function toggleGeofence(geocercaId, activa) {
    db.collection('geocercas').doc(geocercaId).update({
        activa: activa,
        fechaActualizacion: firebase.firestore.FieldValue.serverTimestamp()
    });
}

function flyToGeofence(geocercaId) {
    const geocerca = geocercas.find(g => g.id === geocercaId);
    if (!geocerca) return;

    if (geocerca.tipo === 'circular') {
        map.flyTo({
            center: [geocerca.centro.lng, geocerca.centro.lat],
            zoom: 15
        });
    } else if (geocerca.tipo === 'poligonal' && geocerca.puntos && geocerca.puntos.length > 0) {
        const center = calculatePolygonCenter(geocerca.puntos);
        map.flyTo({
            center: [center.lng, center.lat],
            zoom: 14
        });
    }
}

// ========== ALERTAS ==========
function loadAlerts() {
    if (currentUserRole !== 'admin') return;

    if (alertsListener) {
        alertsListener();
    }

    console.log('Cargando alertas desde Firestore...');

    // SOLUCIÓN: Manejar el error del índice
    const query = db.collection('alertas_geocercas')
        .where('administradorId', '==', auth.currentUser.uid)
        .orderBy('timestamp', 'desc')
        .limit(50);

    alertsListener = query.onSnapshot((querySnapshot) => {
        alertas = [];
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            alertas.push({
                id: doc.id,
                ...data
            });
        });
        console.log('⚠ Alertas cargadas:', alertas.length);
        updateAlertsPanel();

        // Actualizar badge
        updateAlertsBadge();

    }, (error) => {
        console.error('Error cargando alertas:', error);

        // SOLUCIÓN: Cargar sin ordenar si falla el índice
        if (error.code === 'failed-precondition') {
            console.log('Cargando alertas sin ordenar...');
            loadAlertsWithoutOrder();
        }
    });
}

function loadAlertsWithoutOrder() {
    db.collection('alertas_geocercas')
        .where('administradorId', '==', auth.currentUser.uid)
        .limit(50)
        .get()
        .then((querySnapshot) => {
            alertas = [];
            querySnapshot.forEach((doc) => {
                const data = doc.data();
                alertas.push({
                    id: doc.id,
                    ...data
                });
            });

            // Ordenar manualmente por timestamp
            alertas.sort((a, b) => {
                const timeA = a.timestamp?.toDate?.() || new Date(0);
                const timeB = b.timestamp?.toDate?.() || new Date(0);
                return timeB - timeA; // Orden descendente
            });

            console.log('Alertas cargadas (sin índice):', alertas.length);
            updateAlertsPanel();
            updateAlertsBadge();
        })
        .catch((error) => {
            console.error('Error cargando alertas sin orden:', error);
        });
}

// Actualizar badge de alertas
function updateAlertsBadge() {
    const badge = document.getElementById('alertsBadge');
    if (!badge) return;

    const unreadCount = alertas.filter(alerta => !alerta.leida).length;

    if (unreadCount > 0) {
        badge.textContent = unreadCount;
        badge.style.display = 'inline-block';
    } else {
        badge.style.display = 'none';
    }
}

function updateAlertsPanel() {
    const alertsList = document.getElementById('alerts-list');
    if (!alertsList) return;

    if (alertas.length === 0) {
        alertsList.innerHTML = '<div class="loading">No hay alertas recientes</div>';
        return;
    }

    // Filtrar alertas no leídas primero, luego las leídas
    const alertasNoLeidas = alertas.filter(alerta => !alerta.leida);
    const alertasLeidas = alertas.filter(alerta => alerta.leida);

    alertsList.innerHTML = '';

    // Mostrar alertas no leídas primero
    if (alertasNoLeidas.length > 0) {
        alertasNoLeidas.forEach(alerta => {
            alertsList.appendChild(createAlertElement(alerta));
        });
    }

    // Mostrar alertas leídas después
    if (alertasLeidas.length > 0) {
        const leidasSection = document.createElement('div');
        leidasSection.innerHTML = '<div style="padding: 10px; color: var(--verde-grisaceo-oscuro); font-weight: bold; border-top: 2px solid var(--verde-medio-accento); margin-top: 10px;">Alertas Leídas</div>';
        alertsList.appendChild(leidasSection);

        alertasLeidas.forEach(alerta => {
            alertsList.appendChild(createAlertElement(alerta));
        });
    }
}

function createAlertElement(alerta) {
    const fecha = alerta.timestamp?.toDate ? alerta.timestamp.toDate() : new Date();
    const fechaLectura = alerta.fechaLectura?.toDate ? alerta.fechaLectura.toDate() : null;

    // Determinar estilo según el tipo de alerta
    let alertClass = 'alert-item ';
    let icon = '';

    if (alerta.tipo?.includes('controlada')) {
        alertClass += 'critical';
        icon = '●';
    } else if (alerta.tipo?.includes('permitida')) {
        alertClass += 'warning';
        icon = '⚠';
    } else {
        alertClass += 'info';
    }

    // Si está leída, añadir clase adicional
    if (alerta.leida) {
        alertClass += ' alert-read';
    }

    const alertElement = document.createElement('div');
    alertElement.className = alertClass;
    alertElement.innerHTML = `
        <div class="alert-header">
            <span class="alert-type">${icon} ${alerta.descripcion || alerta.tipo}</span>
            <span class="alert-time">${fecha.toLocaleTimeString()}</span>
        </div>
        <div class="alert-details">
            <p><strong>Geocerca:</strong> ${alerta.geocercaNombre || 'N/A'}</p>
            <p><strong>Usuario:</strong> ${alerta.usuarioNombre || alerta.usuarioId}</p>
            <p><strong>Configuración:</strong> ${alerta.configuracion ? `Alertar cuando está ${alerta.configuracion.toUpperCase()}` : 'N/A'}</p>
            <p><strong>Ubicación:</strong> ${alerta.latitud?.toFixed(6)}, ${alerta.longitud?.toFixed(6)}</p>
            ${alerta.leida && fechaLectura ?
                `<p style="color: var(--success); font-size: 11px;"><strong>Leída:</strong> ${fechaLectura.toLocaleTimeString()}</p>` : ''}
        </div>
        <div class="alert-actions">
            <button onclick="flyToLocation(${alerta.longitud}, ${alerta.latitud})" class="alert-btn">
                Ver ubicación
            </button>
            ${!alerta.leida ?
                `<button onclick="markAlertAsRead('${alerta.id}')" class="alert-btn mark-read">
                    Marcar como leída
                </button>` :
                `<span class="alert-read" style="color: var(--success); font-weight: bold;">✓ LEÍDA</span>`
            }
        </div>
    `;

    return alertElement;
}

function closeGeofenceNotification(alertId) {
    // Buscar y eliminar la notificación específica del DOM
    const notifications = document.querySelectorAll('.geofence-alert-notification');
    notifications.forEach(notification => {
        if (notification.getAttribute('data-alert-id') === alertId) {
            notification.remove();
        }
    });
}

function markAlertAsRead(alertId) {
    console.log('Marcando alerta como leída:', alertId);

    db.collection('alertas_geocercas').doc(alertId).update({
        leida: true,
        fechaLectura: firebase.firestore.FieldValue.serverTimestamp()
    })
    .then(() => {
        console.log('Alerta marcada como leída');

        // Actualizar localmente
        const alertaIndex = alertas.findIndex(a => a.id === alertId);
        if (alertaIndex !== -1) {
            alertas[alertaIndex].leida = true;
            alertas[alertaIndex].fechaLectura = new Date();
        }

        // Actualizar interfaz
        updateAlertsPanel();
        updateAlertsBadge();

        // Forzar recarga de alertas para asegurar consistencia
        setTimeout(() => {
            loadAlerts();
        }, 500);

        // Mostrar confirmación
        showTemporaryAlert('Alerta marcada como leída');

    })
    .catch((error) => {
        console.error('Error marcando alerta como leída:', error);
        showTemporaryAlert('Error al marcar como leída: ' + error.message);
    });
}

function confirmDeleteGeofence(geocercaId) {
    if (confirm('¿Estás seguro de que quieres eliminar esta geocerca?')) {
        db.collection('geocercas').doc(geocercaId).delete()
            .then(() => {
                alert('Geocerca eliminada');
            })
            .catch((error) => {
                alert('Error eliminando geocerca: ' + error.message);
            });
    }
}

// ========== AUTENTICACIÓN ==========
function setupAuthListener() {
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            try {
                currentUserRole = await checkUserRole(user);
                showUserInfo(user);
                showMapContent();

                if (currentUserRole === 'admin') {
                    document.getElementById('userSelectorBtn').style.display = 'flex';
                    document.getElementById('userManagementBtn').style.display = 'flex';
                    document.getElementById('geofenceManagementBtn').style.display = 'flex';
                    document.getElementById('geofenceAlertsBtn').style.display = 'flex';
                    document.getElementById('createGeofenceBtn').style.display = 'flex';

                    await loadManagedUsers();
                    loadGeofences();
                    loadAlerts();
                } else {
                    document.getElementById('userSelectorBtn').style.display = 'none';
                    document.getElementById('userManagementBtn').style.display = 'none';
                    document.getElementById('geofenceManagementBtn').style.display = 'none';
                    document.getElementById('geofenceAlertsBtn').style.display = 'none';
                    document.getElementById('createGeofenceBtn').style.display = 'none';
                }

                setTimeout(() => {
                    if (map) map.resize();
                    setupCurrentLocationListener();
                    console.log('Sistema de monitoreo iniciado correctamente');
                }, 1500);

            } catch (error) {
                console.error('Error en setupAuthListener:', error);
            }
        } else {
            showLoginForm();
            hideMapContent();
            clearMarkers();
            stopRealtimeUpdates();
        }
    });
}

// ========== FUNCIONES DE INTERFAZ ==========
function toggleAuth() {
    const user = auth.currentUser;
    if (user) {
        logout();
    } else {
        showAuthOverlay();
    }
}

function showAuthOverlay() {
    document.getElementById('authOverlay').style.display = 'flex';
    document.getElementById('emailInput').value = '';
    document.getElementById('passwordInput').value = '';
    document.getElementById('authError').style.display = 'none';
}

function showLocationsPanel() {
    const user = auth.currentUser;
    if (!user) {
        showAuthOverlay();
        return;
    }
    document.getElementById('locationsPanel').style.display = 'flex';
    loadLocations();
}

function hideLocationsPanel() {
    document.getElementById('locationsPanel').style.display = 'none';
}

function showCurrentLocation() {
    const user = auth.currentUser;
    if (!user) {
        showAuthOverlay();
        return;
    }
    if (currentUserLocationMarker) {
        const lngLat = currentUserLocationMarker.getLngLat();
        flyToLocation(lngLat.lng, lngLat.lat);
    } else {
        showError('No hay ubicación actual disponible');
    }
}

function showUserInfo(user) {
    document.getElementById('userName').textContent = user.email + (currentUserRole === 'admin' ? ' (Admin)' : '');
    document.getElementById('authButton').textContent = 'Cerrar Sesión';
    document.getElementById('authOverlay').style.display = 'none';
}

function showLoginForm() {
    document.getElementById('userName').textContent = 'Iniciar Sesión';
    document.getElementById('authButton').textContent = 'Ingresar';
}

function showMapContent() {
    document.getElementById('mapContent').style.display = 'block';
    document.getElementById('map').style.display = 'block';
    document.getElementById('noAuthMessage').style.display = 'none';
    document.getElementById('floatingLocationBtn').style.display = 'flex';

    setTimeout(() => {
        if (map) {
            map.resize();
        }
    }, 100);
}

function hideMapContent() {
    document.getElementById('mapContent').style.display = 'none';
}

function login() {
    const email = document.getElementById('emailInput').value;
    const password = document.getElementById('passwordInput').value;

    if (!email || !password) {
        showError('Por favor ingresa email y contraseña');
        return;
    }

    auth.signInWithEmailAndPassword(email, password)
        .then((userCredential) => {
            console.log('Usuario autenticado:', userCredential.user);
        })
        .catch((error) => {
            showError('Error al iniciar sesión: ' + error.message);
        });
}

function signup() {
    const email = document.getElementById('emailInput').value;
    const password = document.getElementById('passwordInput').value;

    if (!email || !password) {
        showError('Por favor ingresa email y contraseña');
        return;
    }

    if (password.length < 6) {
        showError('La contraseña debe tener al menos 6 caracteres');
        return;
    }

    auth.createUserWithEmailAndPassword(email, password)
        .then((userCredential) => {
            console.log('Usuario registrado:', userCredential.user);
            return db.collection("usuarios").doc(userCredential.user.uid).set({
                nombre: email.split('@')[0],
                correo: email,
                rol: 'admin',
                administradorId: '',
                tipoDispositivo: 'Web',
                deviceId: 'web-' + Date.now(),
                fechaRegistro: firebase.firestore.FieldValue.serverTimestamp()
            });
        })
        .then(() => {
            console.log('Usuario creado en Firestore');
        })
        .catch((error) => {
            showError('Error al registrarse: ' + error.message);
        });
}

function logout() {
    auth.signOut();
    usuarioSeleccionado = null;
    showNoAuthMessage();
}

function showNoAuthMessage() {
    document.getElementById('map').style.display = 'none';
    document.getElementById('noAuthMessage').style.display = 'block';
    document.getElementById('floatingLocationBtn').style.display = 'none';
}

function showError(message) {
    const errorDiv = document.getElementById('authError');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    setTimeout(() => errorDiv.style.display = 'none', 5000);
}

// ========== UBICACIONES GUARDADAS ==========
function setupRealtimeLocations() {
    const user = auth.currentUser;
    if (!user) return;

    if (locationsListener) {
        locationsListener();
    }

    showLoading();

    let query;
    if (currentUserRole === 'admin' && usuarioSeleccionado) {
        console.log('Cargando ubicaciones para usuario:', usuarioSeleccionado.nombre);
        query = db.collection("ubicaciones_guardadas")
            .where("userId", "==", usuarioSeleccionado.id)
            .orderBy("timestamp", "desc");
    } else if (currentUserRole === 'admin') {
        const usuariosIds = usuariosDisponibles.map(u => u.id);
        console.log('Cargando ubicaciones para usuarios:', usuariosIds);
        query = db.collection("ubicaciones_guardadas")
            .where("userId", "in", usuariosIds)
            .orderBy("timestamp", "desc");
    } else {
        console.log('Cargando ubicaciones para usuario normal:', user.uid);
        query = db.collection("ubicaciones_guardadas")
            .where("userId", "==", user.uid)
            .orderBy("timestamp", "desc");
    }

    locationsListener = query.onSnapshot((querySnapshot) => {
        const locations = [];
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            locations.push({
                id: doc.id,
                ...data
            });
        });

        console.log('Ubicaciones cargadas:', locations.length);
        displayLocations(locations);
    }, (error) => {
        console.error('Error en tiempo real:', error);
        showError('Error cargando ubicaciones: ' + error.message);
    });
}

function loadLocations() {
    const user = auth.currentUser;
    if (!user) return;

    showLoading();
    setupRealtimeLocations();
}

function displayLocations(locations) {
    const locationsList = document.getElementById('locations-list');

    if (locations.length === 0) {
        locationsList.innerHTML = '<div class="loading">No hay ubicaciones guardadas</div>';
        return;
    }

    locationsList.innerHTML = locations.map((location, index) => {
        let date = new Date();
        if (location.timestamp && location.timestamp.toDate) {
            date = location.timestamp.toDate();
        } else if (location.timestamp && location.timestamp.seconds) {
            date = new Date(location.timestamp.seconds * 1000);
        }

        return `
                <div class="location-item" onclick="flyToLocation(${location.longitud}, ${location.latitud})">
                    <div class="location-header">
                        <span class="location-number">${index + 1}</span>
                        <span class="location-coords">${location.latitud.toFixed(4)}, ${location.longitud.toFixed(4)}</span>
                    </div>
                    <div class="location-address">${location.direccion || 'Ubicación guardada'}</div>
                    <div class="location-meta">
                        ${date.toLocaleDateString()} ${date.toLocaleTimeString()}
                        <span>${location.deviceId ? location.deviceId.substring(0, 8) + '...' : 'Móvil'}</span>
                    </div>
                </div>
            `;
    }).join('');
}

function flyToLocation(lng, lat) {
    if (!map) return;

    map.flyTo({
        center: [lng, lat],
        zoom: 15,
        essential: true
    });
}

function clearMarkers() {
    markers.forEach(marker => marker.remove());
    markers = [];
    removeCurrentLocationMarker();
}

function showLoading() {
    document.getElementById('locations-list').innerHTML = '<div class="loading">Cargando ubicaciones...</div>';
}

function stopRealtimeUpdates() {
    if (locationsListener) {
        locationsListener();
        locationsListener = null;
    }
    if (currentLocationListener) {
        currentLocationListener();
        currentLocationListener = null;
    }
    hideRealTimeIndicator();
    removeCurrentLocationMarker();
    hideLocationsPanel();
    console.log('Monitoreo detenido correctamente');
}

// ========== GESTIÓN DE USUARIOS ==========
function checkUserRole(user) {
    return db.collection("usuarios").doc(user.uid).get()
        .then((doc) => {
            if (doc.exists) {
                const userData = doc.data();
                console.log('Datos del usuario:', userData);
                return userData.rol || 'usuario';
            }
            console.log('Usuario no encontrado en Firestore, creando documento...');
            return db.collection("usuarios").doc(user.uid).set({
                nombre: user.email.split('@')[0],
                correo: user.email,
                rol: 'usuario',
                administradorId: '',
                tipoDispositivo: 'Web',
                deviceId: 'web-' + Date.now(),
                fechaRegistro: firebase.firestore.FieldValue.serverTimestamp()
            }).then(() => 'usuario');
        })
        .catch((error) => {
            console.error('Error verificando rol:', error);
            return 'usuario';
        });
}

function loadManagedUsers() {
    const user = auth.currentUser;
    if (!user || currentUserRole !== 'admin') return;

    console.log('Cargando usuarios gestionados para admin:', user.uid);

    return db.collection("usuarios")
        .where("administradorId", "==", user.uid)
        .get()
        .then((querySnapshot) => {
            usuariosDisponibles = [];
            querySnapshot.forEach((doc) => {
                const userData = doc.data();
                usuariosDisponibles.push({
                    id: doc.id,
                    ...userData
                });
            });
            // Añadir el usuario actual también
            usuariosDisponibles.push({
                id: user.uid,
                nombre: user.email,
                correo: user.email,
                rol: 'admin'
            });

            console.log('Usuarios gestionados cargados:', usuariosDisponibles.length);
        })
        .catch((error) => {
            console.error('Error cargando usuarios:', error);
        });
}

function showUserSelector() {
    if (usuariosDisponibles.length === 0) {
        alert('No hay usuarios disponibles. Cargando usuarios...');
        loadManagedUsers().then(() => {
            if (usuariosDisponibles.length > 0) {
                showUserSelector();
            } else {
                alert('Todavía no hay usuarios gestionados.');
            }
        });
        return;
    }

    let userListHTML = '<div style="max-height: 300px; overflow-y: auto; margin: 10px 0;">';
    usuariosDisponibles.forEach((user, index) => {
        userListHTML += `
                <div style="padding: 10px; border-bottom: 1px solid #eee; cursor: pointer;"
                     onclick="selectUser('${user.id}')">
                    <strong>${user.nombre}</strong><br>
                    <small>${user.correo} (${user.rol})</small>
                </div>
            `;
    });
    userListHTML += '</div>';

    const modal = document.createElement('div');
    modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 2000;
        `;

    modal.innerHTML = `
            <div style="background: white; padding: 20px; border-radius: 10px; width: 90%; max-width: 400px;">
                <h3 style="color: #96A78D; margin-bottom: 15px;">Seleccionar Usuario</h3>
                ${userListHTML}
                <button onclick="this.parentElement.parentElement.remove()"
                        style="margin-top: 15px; padding: 8px 15px; background: #ff6b6b; color: white; border: none; border-radius: 5px; cursor: pointer;">
                    Cancelar
                </button>
            </div>
        `;

    document.body.appendChild(modal);
}

function selectUser(userId) {
    const usuario = usuariosDisponibles.find(u => u.id === userId);
    if (usuario) {
        usuarioSeleccionado = usuario;
        alert(`Ahora visualizas las ubicaciones de: ${usuario.nombre}`);

        document.querySelector('div[style*="position: fixed"]')?.remove();

        // RECARGAR Y CONFIGURAR MONITOREO PARA EL USUARIO SELECCIONADO
        setupCurrentLocationListener();
        loadGeofences();

        const panelTitle = document.querySelector('#locationsPanel h3');
        if (panelTitle) {
            panelTitle.innerHTML = `Ubicaciones de ${usuario.nombre} <span class="real-time-indicator" id="realTimeIndicator" style="display: none;">● EN VIVO</span>`;
        }

        console.log(`Monitoreo configurado para usuario: ${usuario.nombre}`);
    }
}

function showUserManagement() {
    const user = auth.currentUser;
    if (!user || currentUserRole !== 'admin') return;

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Crear Nuevo Usuario</h3>
                <p>Agregar un nuevo usuario al sistema de monitoreo</p>
            </div>

            <div class="modal-input-group">
                <label for="userEmail">Correo electrónico</label>
                <input type="email" id="userEmail" placeholder="usuario@empresa.com" required>
                <div class="modal-help-text">El usuario usará este email para iniciar sesión</div>
            </div>

            <div class="modal-input-group">
                <label for="userName">Nombre completo</label>
                <input type="text" id="userName" placeholder="Nombre del usuario" required>
            </div>

            <div class="modal-input-group">
                <label for="userPassword">Contraseña</label>
                <input type="password" id="userPassword" placeholder="Mínimo 6 caracteres" required>
                <div class="modal-help-text">La contraseña debe tener al menos 6 caracteres</div>
            </div>

            <div class="modal-buttons">
                <button class="modal-btn secondary" onclick="closeModal(this)">
                    <span>✕</span> Cancelar
                </button>
                <button class="modal-btn primary" onclick="createNewUser()">
                    <span>✓</span> Crear Usuario
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
}

function createNewUser() {
    const modal = document.querySelector('.modal-overlay');
    if (!modal) {
        console.error('No se encontró el modal');
        return;
    }

    const email = modal.querySelector('#userEmail').value;
    const nombre = modal.querySelector('#userName').value;
    const password = modal.querySelector('#userPassword').value;

    if (!email || !nombre || !password) {
        showTemporaryAlert('Todos los campos son obligatorios');
        return;
    }

    if (password.length < 6) {
        showTemporaryAlert('La contraseña debe tener al menos 6 caracteres');
        return;
    }

    // Validar formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        showTemporaryAlert('Por favor ingresa un email válido');
        return;
    }

    closeAllModals();

    // Mostrar indicador de carga
    showTemporaryAlert('Creando usuario...');

    auth.createUserWithEmailAndPassword(email, password)
        .then((userCredential) => {
            return db.collection("usuarios").doc(userCredential.user.uid).set({
                nombre: nombre,
                correo: email,
                rol: 'usuario',
                administradorId: auth.currentUser.uid,
                tipoDispositivo: 'Por asignar',
                deviceId: '',
                fechaRegistro: firebase.firestore.FieldValue.serverTimestamp()
            });
        })
        .then(() => {
            showTemporaryAlert('✅ Usuario creado exitosamente\n\nEl usuario puede iniciar sesión en la app móvil con las credenciales proporcionadas.');
            loadManagedUsers();
        })
        .catch((error) => {
            console.error('Error creando usuario:', error);
            let errorMessage = 'Error al crear usuario: ';
            if (error.code === 'auth/email-already-in-use') {
                errorMessage += 'El email ya está en uso';
            } else if (error.code === 'auth/invalid-email') {
                errorMessage += 'Email inválido';
            } else if (error.code === 'auth/weak-password') {
                errorMessage += 'Contraseña muy débil';
            } else {
                errorMessage += error.message;
            }
            showTemporaryAlert(errorMessage);
        });
}


// Función auxiliar para obtener valores de formularios de manera segura
function getFormValue(modal, selector) {
    const element = modal.querySelector(selector);
    return element ? element.value : '';
}

// Función para validar formularios
function validateForm(modal, requiredFields) {
    for (const field of requiredFields) {
        const value = getFormValue(modal, field.selector);
        if (!value) {
            showTemporaryAlert(field.errorMessage);
            return false;
        }
    }
    return true;
}

// ========== FUNCIÓN DE DEBUG ==========
function testAlertSystem() {
    if (!usuarioSeleccionado) {
        alert('Selecciona un usuario primero');
        return;
    }

    const testLocation = {
        latitud: -16.500000,
        longitud: -68.124000,
        userId: usuarioSeleccionado.id,
        direccion: 'Ubicación de prueba'
    };
}






//////////////////////PRUEBAS
function showGeofenceStatus() {
    console.log('📊 ESTADO ACTUAL DE GEOCERCAS:');

    geocercas.forEach((geocerca, index) => {
        console.log(`${index + 1}. ${geocerca.nombre}`);
        console.log(`   - Tipo: ${geocerca.tipo}`);
        console.log(`   - Configuración: Alertar cuando está ${geocerca.alertaCuando.toUpperCase()}`);
        console.log(`   - Estado actual: ${geocerca.lastState || 'unknown'}`);
        console.log(`   - Activa: ${geocerca.activa}`);

        if (geocerca.tipo === 'circular') {
            console.log(`   - Centro: ${geocerca.centro.lat}, ${geocerca.centro.lng}`);
            console.log(`   - Radio: ${geocerca.radio}m`);
        } else {
            console.log(`   - Puntos: ${geocerca.puntos.length}`);
        }
        console.log('---');
    });
}



function updateDebugInfo() {
    const debugInfo = document.getElementById('debugInfo');

    const info = `
        <div>👤 Usuario: ${usuarioSeleccionado ? usuarioSeleccionado.nombre : 'No seleccionado'}</div>
        <div>📊 Geocercas: ${geocercas.length} cargadas</div>
        <div>⚠️ Alertas: ${alertas.length} recientes</div>
        <div>📍 Monitoreo: ${currentLocationListener ? 'ACTIVO' : 'INACTIVO'}</div>
        <div>🛠️ Creación: ${isCreatingGeofence ? 'ACTIVA' : 'inactiva'}</div>
    `;

    debugInfo.innerHTML = info;
}

// Actualizar información cada 2 segundos
setInterval(() => {
    if (document.getElementById('debugPanel')?.style.display === 'block') {
        updateDebugInfo();
    }
}, 2000);

// En la consola del navegador (F12)
function consoleTest() {
    // Probar con coordenadas específicas
    testSpecificLocation(-16.5000, -68.1240);

    // Ver estado
    showGeofenceStatus();

    // Ver todas las variables del sistema
    console.log('=== SISTEMA DE ALERTAS ===');
    console.log('Usuario seleccionado:', usuarioSeleccionado);
    console.log('Geocercas:', geocercas);
    console.log('Alertas:', alertas);
    console.log('Listeners activos:', {
        locations: !!locationsListener,
        currentLocation: !!currentLocationListener,
        geofences: !!geofencesListener,
        alerts: !!alertsListener
    });
}

// Función para corregir deviceId de usuarios móviles
async function fixMobileUsersDeviceId() {
    if (currentUserRole !== 'admin') return;

    try {
        const usersSnapshot = await db.collection("usuarios")
            .where("rol", "==", "usuario")
            .get();

        const batch = db.batch();
        let fixedCount = 0;

        usersSnapshot.forEach(doc => {
            const userData = doc.data();

            // Si el usuario tiene deviceId de web pero debería ser móvil
            if (userData.deviceId && userData.deviceId.startsWith('web-')) {
                // Marcar para que la app móvil lo actualice
                batch.update(doc.ref, {
                    deviceId: 'pending-mobile-update',
                    necesitaActualizarDeviceId: true,
                    fechaActualizacion: firebase.firestore.FieldValue.serverTimestamp()
                });
                fixedCount++;
            }
        });

        if (fixedCount > 0) {
            await batch.commit();
            console.log(`✅ ${fixedCount} usuarios marcados para actualización móvil`);
            alert(`${fixedCount} usuarios listos para actualizar deviceId en móvil`);
        }

    } catch (error) {
        console.error('Error corrigiendo usuarios:', error);
    }
}

// Agregar botón en la interfaz de admin
function addFixMobileUsersButton() {
    if (currentUserRole !== 'admin') return;

    const fixBtn = document.createElement('button');
    fixBtn.textContent = '🔧 Corregir Usuarios Móviles';
    fixBtn.title = 'Marcar usuarios para que actualicen deviceId en móvil';
    fixBtn.style.cssText = `
        position: fixed;
        bottom: 200px;
        right: 20px;
        z-index: 1000;
        padding: 10px 15px;
        background: #2196F3;
        color: white;
        border: none;
        border-radius: 5px;
        cursor: pointer;
        font-size: 12px;
    `;
    fixBtn.onclick = fixMobileUsersDeviceId;
    document.body.appendChild(fixBtn);
}

// ========== INICIALIZACIÓN ==========
document.addEventListener('DOMContentLoaded', initializeApp);