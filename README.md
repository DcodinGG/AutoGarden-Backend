# AutoGarden Backend

Node.js service that runs on your **Raspberry Pi** and acts as the system's brain:

- Receives data from the ESP32 via **MQTT**
- Consults the **weather forecast** (OpenWeatherMap)
- Calls **Claude** with full context to decide whether to water and how much
- Publishes the command back to the ESP32 via MQTT
- Exposes a **web dashboard** to configure plants and view history

## Architecture

```
ESP32  ──MQTT──►  Mosquitto  ──►  Backend (this service)
                                      │
                              ┌───────┴────────┐
                              ▼                ▼
                        OpenWeatherMap    Claude API
                              │                │
                              └───────┬────────┘
                                      ▼
                              Watering decision
                                      │
                              ┌───────┴──────────┐
                              ▼                  ▼
                         SQLite DB         MQTT command
                         (history)         → ESP32
```

## Installation on Raspberry Pi

### 1. Install Node.js 20+

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version  # should be v20+
```

### 2. Install Mosquitto

```bash
sudo apt install -y mosquitto mosquitto-clients
sudo systemctl enable mosquitto
sudo systemctl start mosquitto
```

Basic configuration in `/etc/mosquitto/mosquitto.conf`:
```
listener 1883
allow_anonymous false
password_file /etc/mosquitto/passwd
```

Create MQTT user:
```bash
sudo mosquitto_passwd -c /etc/mosquitto/passwd autogarden
sudo systemctl restart mosquitto
```

### 3. Clone and configure the backend

```bash
git clone https://github.com/YOUR_USER/AutoGarden3.0.git
cd AutoGarden3.0/backend

npm install

cp .env.example .env
nano .env   # Fill in your keys
```

### 4. Environment Variables (.env)

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Claude API Key (console.anthropic.com) |
| `OPENWEATHER_API_KEY` | OpenWeatherMap Key (free plan works) |
| `OPENWEATHER_CITY` | City for forecast, e.g., `Madrid` |
| `MQTT_HOST` | Broker IP, usually `localhost` |
| `MQTT_USER` / `MQTT_PASSWORD` | Mosquitto credentials |
| `PORT` | Web dashboard port (default: 3000) |

### 5. Start the service

```bash
node index.js
# Dashboard available at http://localhost:3000
```

### 6. Run as a service (systemd)

Create `/etc/systemd/system/autogarden.service`:

```ini
[Unit]
Description=AutoGarden Backend
After=network.target mosquitto.service

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/AutoGarden3.0/backend
ExecStart=/usr/bin/node index.js
Restart=on-failure
RestartSec=10
EnvironmentFile=/home/pi/AutoGarden3.0/backend/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable autogarden
sudo systemctl start autogarden
sudo journalctl -u autogarden -f  # See logs in real-time
```

## REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/plants` | List of configured plants |
| PUT | `/api/plants/:id` | Create or update plant |
| DELETE | `/api/plants/:id` | Delete plant |
| GET | `/api/history?limit=50` | Decision history |
| GET | `/api/status` | Backend status |

## MQTT Payload — Command to ESP32

The backend publishes to `autogarden/command`:

```json
{
  "timestamp": "2025-03-09T10:30:00.000Z",
  "plants": [
    { "id": 1, "water": true,  "duration_secs": 12 },
    { "id": 2, "water": false, "duration_secs": 0  },
    { "id": 3, "water": true,  "duration_secs": 8  }
  ]
}
```

## Integration with ESP32

The ESP32 (AutoGarden v3.0) must subscribe to `autogarden/command`
and execute watering according to the instructions received.
See `src/mqtt_client.cpp` in the ESP32 project.

## Fallback

If the Claude API is not available (no connection, no key), the system
uses simple fixed-threshold logic (water if moisture < 30%) so the
garden never goes unwatered.
