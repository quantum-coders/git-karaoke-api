// karaoke-tests.js
// Script de ejemplo para probar las rutas de Karaoke API con axios
// sin simulaciones de callbacks manuales.

import axios from 'axios';

// Ajusta tu URL base (por ejemplo, ngrok o tu dominio real)
const BASE_URL = 'https://8733-2806-2f0-74a1-ff77-8eeb-81c4-3832-dc7c.ngrok-free.app';

function logResponse(name, resp) {
  console.log(`\n=== ${name} ===`);
  if (resp?.status) {
    console.log(`Status: ${resp.status}`);
    console.log('Data:', JSON.stringify(resp.data, null, 2));
  } else {
    console.log('No response object?');
    console.log(resp);
  }
}

// Función auxiliar: hacer “polling” de la tarea hasta que cambie de estado
async function pollTaskStatus(taskId, maxAttempts = 12, intervalMs = 10000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`\n🔄 Polling #${attempt} for taskId=${taskId}`);

    let resp;
    try {
      resp = await axios.get(`${BASE_URL}/karaoke/tasks/${taskId}`);
      logResponse(`GET /karaoke/tasks/${taskId}`, resp);
    } catch (err) {
      console.warn(`GET /karaoke/tasks/${taskId} error:`, err.response?.data || err.message);
      break;
    }

    // Extrae el status real
    const resultData = resp?.data?.data;
    const songStatus = resultData?.songStatus || 'UNKNOWN';

    if (songStatus === 'COMPLETED' || songStatus === 'SUCCESS') {
      console.log(`✅ Tarea ${taskId} se completó!`);
      return;
    }
    if (songStatus.includes('FAILED') || songStatus.includes('ERROR')) {
      console.warn(`❌ Tarea ${taskId} falló con status: ${songStatus}`);
      return;
    }

    // Si sigue en PENDING, esperamos “intervalMs” y luego repetimos
    if (attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    } else {
      console.warn(`⚠️ Tarea sigue en PENDING luego de ${maxAttempts} intentos. Abandonamos polling.`);
    }
  }
}

async function testEverything() {
  try {
    // 1) GET /karaoke/styles
    const stylesResp = await axios.get(`${BASE_URL}/karaoke/styles`);
    logResponse('GET /karaoke/styles', stylesResp);

    // 2) GET /karaoke/config
    const configResp = await axios.get(`${BASE_URL}/karaoke/config`);
    logResponse('GET /karaoke/config', configResp);

    // 3) POST /karaoke => Crea nueva canción
    const createSongResp = await axios.post(`${BASE_URL}/karaoke`, {
      repoUrl: 'https://github.com/vercel/next.js',
      timeRange: 'day',
      musicStyle: 'Rap',
      instrumental: false,
      callbackUrl: `${BASE_URL}`
    });
    logResponse('POST /karaoke (createSong)', createSongResp);

    // 4) Extraer taskId
    let newTaskId;
    const rData = createSongResp.data;
    if (rData?.data?.song?.taskId) {
      newTaskId = rData.data.song.taskId;
      console.log(`\n✅ taskId detectado: ${newTaskId}`);
    } else {
      console.warn('⚠️ No se pudo obtener taskId de la respuesta');
    }

    // 5) GET /karaoke => Listado de canciones
    const listSongsResp = await axios.get(`${BASE_URL}/karaoke`, { params: { limit: 10, offset: 0 } });
    logResponse('GET /karaoke', listSongsResp);

    // 5.1) Buscar la que tenga suno_task_id = newTaskId
    let newSongId;
    const allSongs = listSongsResp.data?.data;
    if (Array.isArray(allSongs)) {
      const found = allSongs.find(song => song.suno_task_id === newTaskId);
      if (found) {
        newSongId = found.id;
        console.log(`\n✅ Song en DB con ID = ${newSongId}`);
      } else {
        console.warn(`⚠️ No se encontró Song con suno_task_id=${newTaskId}`);
      }
    }

    // 6) GET /karaoke/:songId (detalle simple)
    if (newSongId) {
      try {
        const songDetailResp = await axios.get(`${BASE_URL}/karaoke/${newSongId}`);
        logResponse(`GET /karaoke/${newSongId}`, songDetailResp);
      } catch (err) {
        console.warn(`GET /karaoke/${newSongId} error:`, err.response?.data || err.message);
      }
    }

    // 7) GET /karaoke/tasks/:taskId (estado inicial de la tarea)
    if (newTaskId) {
      try {
        const taskStatusResp = await axios.get(`${BASE_URL}/karaoke/tasks/${newTaskId}`);
        logResponse(`GET /karaoke/tasks/${newTaskId}`, taskStatusResp);
      } catch (err) {
        console.warn(`GET /karaoke/tasks/${newTaskId} error:`, err.response?.data || err.message);
      }
    }

    // 8) GET /karaoke/stats
    const statsResp = await axios.get(`${BASE_URL}/karaoke/stats`);
    logResponse('GET /karaoke/stats', statsResp);

    // 9) GET /karaoke/:songId/detailed => Detalle extendido
    if (newSongId) {
      try {
        const detailedResp = await axios.get(`${BASE_URL}/karaoke/${newSongId}/detailed`);
        logResponse(`GET /karaoke/${newSongId}/detailed`, detailedResp);
      } catch (err) {
        console.warn(`GET /karaoke/${newSongId}/detailed error:`, err.response?.data || err.message);
      }
    }

    // 10) Aquí hacemos polling para ver cuándo se completa la tarea
    if (newTaskId && newSongId) {
      console.log('\n⏳ Esperando a que se complete la generación de la canción en Suno...');
      await pollTaskStatus(newTaskId, /*maxAttempts*/ 100, /*intervalMs*/ 10000);

      // 11) Cuando termine, consultamos la canción de nuevo
      console.log(`\n🔍 Revisamos de nuevo /karaoke/${newSongId} para ver si se completó y hay audio_files:`);
      try {
        const finalDetailResp = await axios.get(`${BASE_URL}/karaoke/${newSongId}/detailed`);
        logResponse(`GET /karaoke/${newSongId}/detailed (final)`, finalDetailResp);
      } catch (err) {
        console.warn(`GET /karaoke/${newSongId}/detailed (final) error:`, err.response?.data || err.message);
      }
    }

    console.log('\n✅ All requests completed with polling.\n');
  } catch (error) {
    console.error('❌ Error in testEverything:', error.message);
  }
}

testEverything();
