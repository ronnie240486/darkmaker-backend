
import React, { useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { VideoTools, VideoToolId } from './pages/VideoTools';
import { ImageTools, ImageToolId } from './pages/ImageTools';
import { TextTools, TextToolId } from './pages/TextTools';
import { AudioTools, AudioToolId } from './pages/AudioTools';
import { StockMedia } from './pages/StockMedia';
import { Projects } from './pages/Projects';
import { Settings } from './pages/Settings';
import { Utilities } from './pages/Utilities';
import { PageId } from './types';

const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<PageId>('home');
  const [activeTool, setActiveTool] = useState<string | undefined>(undefined);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const handleNavigate = (page: PageId, tool?: string) => {
      setCurrentPage(page);
      setActiveTool(tool);
      setIsSidebarOpen(false);
  };

  const renderPage = () => {
    switch (currentPage) {
      case 'home': return <Dashboard onNavigate={handleNavigate} />;
      case 'video-tools': return <VideoTools initialTool={activeTool as VideoToolId} />;
      case 'image-tools': return <ImageTools initialTool={activeTool as ImageToolId} />;
      case 'text-tools': return <TextTools initialTool={activeTool as TextToolId} />;
      case 'audio-tools': return <AudioTools initialTool={activeTool as AudioToolId} />;
      case 'stock-media': return <StockMedia />;
      case 'projects': return <Projects />;
      case 'settings': return <Settings />;
      case 'utilities': return <Utilities onNavigate={handleNavigate} />;
      default: return <Dashboard onNavigate={handleNavigate} />;
    }
  };

  return (
    <div className="flex h-screen bg-[#050505] text-white overflow-hidden font-sans">
      <Sidebar 
        currentPage={currentPage} 
        onNavigate={(page) => handleNavigate(page)} 
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
      />
      
      <main className="flex-1 overflow-y-auto flex flex-col relative custom-scrollbar">
        {/* Main App Header */}
        <header className="flex items-center justify-between p-4 md:px-10 md:py-6 border-b border-white/5 bg-[#0a0a0a]/50 backdrop-blur-xl sticky top-0 z-30">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="md:hidden p-2 text-gray-400 hover:text-white"
            >
              <i className="fas fa-bars text-xl"></i>
            </button>
            <h2 className="text-sm font-black text-white uppercase tracking-tighter italic">
              Studio <span className="mx-2 text-gray-700">/</span> <span className="text-blue-500">{currentPage.replace('-', ' ')}</span>
            </h2>
          </div>
          
          <div className="flex items-center gap-3">
             <button 
               onClick={() => handleNavigate('settings')}
               className={`p-2.5 rounded-xl border transition-all ${currentPage === 'settings' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-white/5 border-white/10 text-gray-400 hover:text-white hover:bg-white/10'}`}
               title="Settings"
             >
                <i className="fas fa-cog text-sm"></i>
             </button>
             <button 
               onClick={() => handleNavigate('home')}
               className="hidden md:flex items-center gap-2 px-4 py-2 bg-blue-600 rounded-xl text-[10px] font-black uppercase tracking-wider shadow-lg shadow-blue-900/40"
             >
                Dashboard
             </button>
          </div>
        </header>

        <div className="flex-1 p-4 md:p-10">
          <div className="max-w-7xl mx-auto">
              {renderPage()}
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
