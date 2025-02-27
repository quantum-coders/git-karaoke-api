// test-stats.js
import axios from 'axios';

const BASE_URL = 'http://localhost:1337'; // Ajusta tu puerto/API

async function testKaraokeStats() {
	try {
		const response = await axios.get(`${ BASE_URL }/karaoke/stats`);
		console.log('GET /karaoke/stats -> Status:', response.status);
		console.log('Response Data:', response.data);
	} catch(error) {
		console.error('Error GET /karaoke/stats:', error.response?.status, error.response?.data || error.message);
	}
}

testKaraokeStats();
