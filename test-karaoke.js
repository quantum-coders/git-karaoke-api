import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import KaraokeService from '#services/karaoke.service.js';

// Create a simple Express server to handle callbacks
const app = express();
app.use(bodyParser.json());
const PORT = process.env.PORT || 3000;

// Store task IDs and results
const tasks = new Map();

// Test function to generate a song from a repository
async function testGenerateSongFromRepo() {
  try {
    console.log('🧪 Starting test: Generate song from GitHub repository');

    // Configure callback server
    const callbackUrl = (process.env.CALLBACK_URL || `http://localhost:${PORT}`) + '/callback';

    // Repository to analyze (change this to your target repository)
    const repoUrl = 'https://github.com/near/near-cli-rs';

    // Generate song
    const result = await KaraokeService.generateSongFromRepo({
      repoUrl,
      timeRange: 'week', // 'day', 'week', or 'custom'
      // For custom time range, uncomment these lines:
      // startDate: new Date('2023-01-01'),
      // endDate: new Date('2023-01-31'),
      musicStyle: 'Rock', // Choose music style
      instrumental: false, // Set to true for instrumental music
      callbackUrl
    });

    console.log('✅ Song generation initiated successfully:');
    console.log(JSON.stringify(result, null, 2));

    // Store task ID
    tasks.set(result.song.taskId, {
      status: 'pending',
      repository: result.repository,
      song: result.song
    });

    // Optionally wait for completion
    console.log('⏳ Waiting for song generation to complete...');
    const completedTask = await KaraokeService.waitForSongCompletion(result.song.taskId);
    console.log('✅ Song generation completed:', completedTask);

    return result;
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    throw error;
  }
}

// Callback handler
app.post('/callback', async (req, res) => {
  try {
    console.log('📞 Received callback from Suno API');
    console.log(JSON.stringify(req.body, null, 2));

    // Process callback
    const result = await KaraokeService.handleSunoCallback(req.body);

    // Update task status in local tasks map
    // `result.doAttachments` typically contains info of the DO upload, including URLs
    if (req.body.data?.task_id && tasks.has(req.body.data.task_id)) {
      const taskId = req.body.data.task_id;
      const task = tasks.get(taskId);

      // Mark the task as completed
      task.status = 'completed';
      // Save the result with doAttachments, etc.
      task.result = result;

      tasks.set(taskId, task);
    }

    // Send JSON response including the doAttachments so you can see the DO URLs
    res.json({
      status: 'success',
      message: 'Callback processed',
      doAttachments: result.doAttachments || []
    });
  } catch (error) {
    console.error('❌ Error processing callback:', error.message);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// Route to check task status
app.get('/tasks/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;

    // Check if task is in our local cache
    if (tasks.has(taskId)) {
      // This object should now contain doAttachments in `task.result.doAttachments` if the callback was processed
      res.json({ status: 'success', task: tasks.get(taskId) });
      return;
    }

    // If not in cache, check with Suno API
    const result = await KaraokeService.checkSongStatus(taskId);
    res.json({ status: 'success', task: result });
  } catch (error) {
    console.error('❌ Error checking task:', error.message);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔗 Callback URL: http://localhost:${PORT}/callback`);

  // Start the test when the server is ready
  if (process.env.AUTO_START === 'true') {
    console.log('🔄 Auto-starting test...');
    testGenerateSongFromRepo()
      .then(() => console.log('✅ Test completed successfully'))
      .catch(error => console.error('❌ Test failed:', error));
  } else {
    console.log('ℹ️ Run the test manually with: node test-karaoke.js test');
  }
});

// Run test if called directly
if (process.argv[2] === 'test') {
  testGenerateSongFromRepo()
    .then(() => console.log('✅ Test completed successfully'))
    .catch(error => console.error('❌ Test failed:', error));
}

// Export for programmatic usage
export { testGenerateSongFromRepo };
