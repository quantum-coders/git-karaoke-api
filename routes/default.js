import { Primate } from '@thewebchimp/primate';
import KaraokeController from '../controllers/karaoke.controller.js';

const router = Primate.getRouter();

// 1) Retorna estilos musicales
router.get('/karaoke/styles', KaraokeController.getAvailableStyles);

// 2) Retorna configuraciones globales
router.get('/karaoke/config', KaraokeController.getGlobalConfig);

// 3) Crea una nueva canción
router.post('/karaoke', KaraokeController.createSongFromRepo);

// 4) Lista TODAS las canciones
router.get('/karaoke', KaraokeController.getAllSongs);

/**
 * 8) Estadísticas globales
 * ¡Ponemos /karaoke/stats ANTES de /karaoke/:songId para evitar colisión!
 */
router.get('/karaoke/stats', KaraokeController.getKaraokeStats);

// callbacks
router.post('/karaoke/callback', KaraokeController.handleSunoCallback);
router.post('/karaoke/callback/lyrics', KaraokeController.handleSunoCallbackLyrics);

// 7) Consulta el estado de una tarea (SunoTaskId)
router.get('/karaoke/tasks/:taskId', KaraokeController.checkSongTaskStatus);

// 5) Detalle de UNA canción
router.get('/karaoke/:songId', KaraokeController.getSongById);

// 9) Detalle extendido
router.get('/karaoke/:songId/detailed', KaraokeController.getSongDetailed);

export { router };
