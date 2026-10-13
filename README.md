# Plitt Fit · versión web

Versión para navegador de la app [gymtrack](../gymtrack). Es el mismo código (Expo SDK 57 + React Native Web + Expo Router), adaptado a lo que existe en un navegador. Es un proyecto independiente de la app del celular; los datos se comparten entre ambas con la sincronización (ver abajo).

## Cómo correrla

```bash
npm install
npm start          # servidor de desarrollo en http://localhost:8081
npm run build      # genera el sitio estático en dist/
```

## Diferencias con la app

| En el celular | En la web |
|---|---|
| Tabs nativas | Barra de tabs de Expo Router, contenido centrado (máx. 800 px) |
| `Alert` del sistema | Diálogo propio (`src/components/dialog.tsx`), porque `Alert` no hace nada en web |
| API key de Claude cifrada con `expo-secure-store` | `localStorage` del navegador, **sin cifrar** |
| Fotos de progreso en la carpeta de la app | Se achican a 1200 px y se guardan dentro de la base como JPEG |
| Sacar foto con la cámara o elegir de la galería | Un solo botón que abre el selector de archivos del navegador |
| Recordatorio de los lunes (notificación local) | No existe: un sitio no puede programar notificaciones sin servidor |
| Mantener presionado para borrar una serie o un registro de peso | Clic en el número de la serie / botón "Eliminar" |

## Datos

Todo se guarda en el navegador con `expo-sqlite` (SQLite compilado a wasm, persistido en OPFS). Sobreviven a cerrar la pestaña o el navegador. Son de ese navegador y ese dominio, y se pierden si se borran los datos del sitio: con la sincronización activada se recuperan al iniciar sesión.

El soporte web de `expo-sqlite` está en alpha.

## Publicarla (GitHub Pages)

La web se publica en GitHub Pages, en `https://USUARIO.github.io/gymtrack-web/`. Para subir una versión nueva:

```bash
npm run deploy
```

Ese comando compila el sitio y lo sube a la rama `gh-pages` del repositorio. El nombre del repositorio tiene que coincidir con `experiments.baseUrl` en `app.json` (`/gymtrack-web`).

GitHub Pages no permite configurar encabezados, así que el sitio no usa `SharedArrayBuffer`; la app solo usa la API asíncrona de SQLite, que funciona sin él. Como Pages tampoco tiene rutas de SPA, el deploy copia `index.html` a `404.html` para que recargar en cualquier pantalla funcione.

Los datos del navegador dependen de la dirección: lo cargado en `localhost` no aparece en la dirección publicada, salvo lo que venga por la sincronización.

## Sincronización (Supabase)

Las apps siguen guardando todo en SQLite local y funcionan sin conexión. Con una cuenta iniciada, `src/lib/sync.ts` copia los cambios a una tabla de Supabase y trae los de los otros dispositivos: al abrir la app, al volver a ella, a los pocos segundos de guardar algo y cada 30 segundos mientras está abierta.

Se sincronizan rutinas, entrenamientos **terminados**, registros de peso, perfil y peso objetivo. No se sincronizan las fotos de progreso, la API key de Claude, el tema ni un entrenamiento en curso. Si el mismo dato se edita en dos dispositivos, queda la versión más reciente.

Puesta en marcha (una sola vez):

1. Crear un proyecto en [supabase.com](https://supabase.com).
2. En el SQL Editor del proyecto, ejecutar `supabase/schema.sql`.
3. Copiar la URL del proyecto y la publishable key en `.env` (en la app y en la web):
   ```
   EXPO_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
   EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```
4. Reiniciar `expo start` (y volver a generar el build de la app o de la web, porque estos valores se incluyen al compilar).
5. En Ajustes → Sincronización, crear la cuenta en un dispositivo e iniciar sesión con la misma en el otro.

Supabase pide confirmar el email al crear la cuenta; se puede desactivar en Authentication → Sign In / Providers → Email.

El código de sincronización (`sync.ts`, `sync-schema.ts`, `supabase.ts`, `sync-settings.tsx`) está duplicado en `gymtrack` y `gymtrack-web`: un cambio en uno hay que copiarlo al otro.

## Comandos

```bash
npx tsc --noEmit   # typecheck
npx expo lint      # lint
```
