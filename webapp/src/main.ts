/**
 * Main entry point — Spork Motion Brewing Game
 *
 * Sets up the page-based UI and WebSocket motion detection.
 */
import './styles/main.css';

import { router } from './pages/router.ts';
import { createMainMenu } from './pages/MainMenu.ts';
import { createLevelSelect } from './pages/LevelSelect.ts';
import { createPlayPage } from './pages/Play.ts';
import { createTutorial } from './pages/Tutorial.ts';
import { createTutorialDetail } from './pages/TutorialDetail.ts';
import { createChoreograph } from './pages/Choreograph.ts';
import { motionDetector } from './components/MotionDetector.ts';

function init(): void {
  // Apply saved theme (default: dark)
  const savedTheme = localStorage.getItem('spork-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);

  console.log('☕ Spork — Initializing…');

  const app = document.getElementById('app')!;

  // 1. Mount all pages into #app
  app.appendChild(createMainMenu());
  app.appendChild(createLevelSelect());
  app.appendChild(createPlayPage());
  app.appendChild(createTutorial());
  app.appendChild(createTutorialDetail());
  app.appendChild(createChoreograph());

  // 2. Navigate to main menu
  router.go('main-menu');

  // 3. Connect WebSocket to Python backend
  motionDetector.connect();

  // 4. Debug logging
  document.addEventListener('motion-detected', ((e: CustomEvent) => {
    const { motion, confidence } = e.detail;
    console.log(`🎯 Motion: ${motion} (${Math.round(confidence * 100)}%)`);
  }) as EventListener);

  router.onNavigate((_from, to) => console.log(`📄 Page → ${to}`));

  console.log('☕ Spork — Ready!');
}

init();
