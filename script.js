const chatBox = document.getElementById('chat-box');
const chatForm = document.getElementById('chat-form');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const welcomeScreen = document.getElementById('welcome-screen');
const newsList = document.getElementById('news-list');
const refreshNewsBtn = document.getElementById('refresh-news-btn');

let chatHistory = [];
let isFirstAnalysis = true;

let sessions = JSON.parse(localStorage.getItem('quibly_sessions')) || {};
let currentSessionId = Date.now().toString();

if (!sessions[currentSessionId]) {
    sessions[currentSessionId] = { title: 'New Chat', history: [], updatedAt: Date.now() };
}

function saveSessions() {
    localStorage.setItem('quibly_sessions', JSON.stringify(sessions));
    renderHistoryList();
}

// API server URL - points to Flask backend
// In production (Render.com), the frontend and backend are on the same domain, so use ''
// In local dev with Live Server (port 5500), we need to point explicitly to Flask on 5005
const API_SERVER = (window.location.port === '5500' || window.location.protocol === 'file:')
    ? 'http://127.0.0.1:5005'
    : '';

// Configure marked.js to sanitize and format nicely
marked.setOptions({
    breaks: true,
    gfm: true
});

const themeToggleBtn = document.getElementById('theme-toggle');
const themes = ['default', 'pitch-dark', 'light'];
let currentThemeIndex = 0;

themeToggleBtn.addEventListener('click', () => {
    currentThemeIndex = (currentThemeIndex + 1) % themes.length;
    const newTheme = themes[currentThemeIndex];
    if (newTheme === 'default') {
        document.documentElement.removeAttribute('data-theme');
    } else {
        document.documentElement.setAttribute('data-theme', newTheme);
    }
});

function appendMessage(role, content) {
    if (welcomeScreen && welcomeScreen.parentNode) welcomeScreen.remove();

    const row = document.createElement('div');
    row.classList.add('message-row');

    if (role === 'user') {
        row.classList.add('user-row');

        const avatar = document.createElement('div');
        avatar.className = 'msg-avatar user-avatar';
        avatar.textContent = 'YOU';

        const bubble = document.createElement('div');
        bubble.classList.add('message', 'message-user');
        bubble.textContent = content;

        row.appendChild(avatar);
        row.appendChild(bubble);

    } else if (role === 'model') {
        const avatar = document.createElement('div');
        avatar.className = 'msg-avatar ai-avatar';
        avatar.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><path d="M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3z"></path></svg>';

        const bubble = document.createElement('div');
        bubble.classList.add('message', 'message-ai');

        const contentDiv = document.createElement('div');
        contentDiv.innerHTML = marked.parse(content);
        bubble.appendChild(contentDiv);

        // Action row
        const actionRow = document.createElement('div');
        actionRow.className = 'msg-actions';

        const copyBtn = document.createElement('button');
        copyBtn.className = 'msg-action-btn';
        copyBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg> Copy`;
        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(content);
            copyBtn.classList.add('active');
            copyBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg> Copied`;
            setTimeout(() => { copyBtn.classList.remove('active'); copyBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg> Copy`; }, 2000);
        });

        const bookmarkBtn = document.createElement('button');
        bookmarkBtn.className = 'msg-action-btn';
        bookmarkBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg> Save`;
        bookmarkBtn.addEventListener('click', () => {
            let marks = JSON.parse(localStorage.getItem('quibly_chat_bookmarks')) || [];
            marks.unshift({ content, date: Date.now() });
            localStorage.setItem('quibly_chat_bookmarks', JSON.stringify(marks));
            bookmarkBtn.classList.add('active');
            bookmarkBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg> Saved`;
        });

        const regenBtn = document.createElement('button');
        regenBtn.className = 'msg-action-btn';
        regenBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg> Retry`;
        regenBtn.addEventListener('click', () => {
            if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === 'model') chatHistory.pop();
            const lastUserMsg = chatHistory[chatHistory.length - 1]?.content || 'Regenerate response';
            if (chatHistory.length > 0) chatHistory.pop();
            row.remove();
            sendChatRequest(lastUserMsg);
        });

        actionRow.appendChild(copyBtn);
        actionRow.appendChild(bookmarkBtn);
        actionRow.appendChild(regenBtn);
        bubble.appendChild(actionRow);

        row.appendChild(avatar);
        row.appendChild(bubble);
    }

    chatBox.appendChild(row);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function showTypingIndicator() {
    const row = document.createElement('div');
    row.classList.add('message-row');
    row.id = 'typing-indicator';

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar ai-avatar';
    avatar.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><path d="M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3z"></path></svg>';

    const bubble = document.createElement('div');
    bubble.className = 'typing-indicator';
    bubble.innerHTML = `<div class="typing-dots"><span></span><span></span><span></span></div><span class="typing-label">Quibly is thinking...</span>`;

    row.appendChild(avatar);
    row.appendChild(bubble);
    chatBox.appendChild(row);
    chatBox.scrollTop = chatBox.scrollHeight;
}



function removeTypingIndicator() {
    const indicator = document.getElementById('typing-indicator');
    if (indicator) indicator.remove();
}

function loadSession(id) {
    if (!sessions[id]) return;
    currentSessionId = id;
    chatHistory = [...sessions[id].history];
    isFirstAnalysis = chatHistory.length === 0;
    
    Array.from(chatBox.children).forEach(child => {
        if (child.id !== 'welcome-screen') child.remove();
    });
    
    if (chatHistory.length === 0) {
        if (welcomeScreen && !welcomeScreen.parentNode) {
            chatBox.appendChild(welcomeScreen);
        }
    } else {
        if (welcomeScreen && welcomeScreen.parentNode) {
            welcomeScreen.remove();
        }
        chatHistory.forEach(msg => {
            const messageDiv = document.createElement('div');
            messageDiv.classList.add('message');
            if (msg.role === 'user') {
                messageDiv.classList.add('message-user');
                messageDiv.textContent = msg.content;
            } else if (msg.role === 'model') {
                messageDiv.classList.add('message-ai');
                const contentDiv = document.createElement('div');
                contentDiv.innerHTML = marked.parse(msg.content);
                messageDiv.appendChild(contentDiv);
                
                const actionRow = document.createElement('div');
                actionRow.style.cssText = 'display: flex; gap: 8px; margin-top: 8px; justify-content: flex-end; opacity: 0.5; transition: opacity 0.2s;';
                
                const copyBtn = document.createElement('button');
                copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
                copyBtn.title = "Copy";
                copyBtn.style.cssText = 'background: transparent; border: none; cursor: pointer; color: var(--text); padding: 4px;';
                copyBtn.addEventListener('click', () => {
                    navigator.clipboard.writeText(msg.content);
                    copyBtn.style.color = 'var(--accent)';
                    setTimeout(() => copyBtn.style.color = 'var(--text)', 2000);
                });
                
                const bookmarkBtn = document.createElement('button');
                bookmarkBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>';
                bookmarkBtn.title = "Bookmark";
                bookmarkBtn.style.cssText = 'background: transparent; border: none; cursor: pointer; color: var(--text); padding: 4px;';
                bookmarkBtn.addEventListener('click', () => {
                    let chatMarks = JSON.parse(localStorage.getItem('quibly_chat_bookmarks')) || [];
                    chatMarks.unshift({ content: msg.content, date: Date.now() });
                    localStorage.setItem('quibly_chat_bookmarks', JSON.stringify(chatMarks));
                    bookmarkBtn.style.color = 'var(--accent)';
                    bookmarkBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>';
                });
                
                actionRow.appendChild(copyBtn);
                actionRow.appendChild(bookmarkBtn);
                messageDiv.addEventListener('mouseenter', () => actionRow.style.opacity = '1');
                messageDiv.addEventListener('mouseleave', () => actionRow.style.opacity = '0.5');
                messageDiv.appendChild(actionRow);
            }
            chatBox.appendChild(messageDiv);
        });
        chatBox.scrollTop = chatBox.scrollHeight;
    }
    
    userInput.placeholder = chatHistory.length === 0 ? "Enter a headline or ask a question..." : "Ask a follow-up question...";
    renderHistoryList();
    openChatView();
}

function startNewChat() {
    currentSessionId = Date.now().toString();
    sessions[currentSessionId] = { title: 'New Chat', history: [], updatedAt: Date.now() };
    loadSession(currentSessionId);
    saveSessions();
}
async function sendChatRequest(message) {
    showTypingIndicator();
    sendBtn.disabled = true;
    
    try {
        let endpoint = '';
        let body = {};
        
        if (isFirstAnalysis) {
            // First message is treated as a headline analysis
            endpoint = '/api/analyze';
            body = { headline: message };
        } else {
            // Subsequent messages are regular chat
            endpoint = '/api/chat';
            body = { message: message, history: chatHistory };
        }
        
        const response = await fetch(`${API_SERVER}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        
        const data = await response.json();
        
        removeTypingIndicator();
        sendBtn.disabled = false;
        
        if (data.error) {
            appendMessage('model', `**Error:** ${data.error}`);
        } else {
            const aiText = data.response;
            appendMessage('model', aiText);
            
            // Record history
            chatHistory.push({ role: 'user', content: message });
            chatHistory.push({ role: 'model', content: aiText });
            
            if (chatHistory.length === 2) {
                sessions[currentSessionId].title = message.length > 25 ? message.substring(0, 25) + '...' : message;
            }
            sessions[currentSessionId].history = [...chatHistory];
            sessions[currentSessionId].updatedAt = Date.now();
            saveSessions();
            
            isFirstAnalysis = false;
            
            userInput.placeholder = "Ask a follow-up question...";
        }
    } catch (err) {
        removeTypingIndicator();
        sendBtn.disabled = false;
        appendMessage('model', `**Connection Error:** Make sure backend is running. Details: ${err.message}`);
    }
}

chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = userInput.value.trim();
    if (!text) return;
    
    userInput.value = '';
    appendMessage('user', text);
    sendChatRequest(text);
});

// Sidebar logic
const chatHistoryList = document.querySelector('.chat-history-list');

function renderHistoryList() {
    if (!chatHistoryList) return;
    chatHistoryList.innerHTML = '';
    
    const sortedIds = Object.keys(sessions).sort((a, b) => sessions[b].updatedAt - sessions[a].updatedAt);
    let lastDateGroup = '';

    sortedIds.forEach(id => {
        const session = sessions[id];
        if (session.history.length === 0 && id !== currentSessionId) return; 

        const dateObj = new Date(session.updatedAt);
        const dayString = dateObj.toLocaleDateString();
        let groupName = 'Past';
        const today = new Date().toLocaleDateString();
        const yesterday = new Date(Date.now() - 86400000).toLocaleDateString();

        if (dayString === today) groupName = 'Today';
        else if (dayString === yesterday) groupName = 'Yesterday';
        else groupName = dateObj.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

        if (groupName !== lastDateGroup) {
            const grp = document.createElement('div');
            grp.classList.add('date-group');
            grp.textContent = groupName;
            chatHistoryList.appendChild(grp);
            lastDateGroup = groupName;
        }

        const item = document.createElement('div');
        item.classList.add('history-item');
        if (id === currentSessionId) item.classList.add('active');

        const contentDiv = document.createElement('div');
        contentDiv.classList.add('history-content');
        contentDiv.innerHTML = `
            <div class="history-title">${session.title}</div>
            <div class="history-time">${dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
        `;
        
        contentDiv.addEventListener('click', () => {
            loadSession(id);
        });

        const delBtn = document.createElement('button');
        delBtn.classList.add('delete-btn');
        delBtn.textContent = '✕';
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            delete sessions[id];
            if (id === currentSessionId) {
                startNewChat();
            } else {
                saveSessions();
            }
        });

        item.appendChild(contentDiv);
        item.appendChild(delBtn);
        chatHistoryList.appendChild(item);
    });
}

const newChatBtn = document.getElementById('new-chat-btn');
if (newChatBtn) newChatBtn.addEventListener('click', startNewChat);

const clearHistoryBtn = document.querySelector('.clear-history-btn');
if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', () => {
        sessions = {};
        startNewChat();
    });
}

// Initial render
renderHistoryList();

async function loadNews() {
    newsList.innerHTML = '<div class="news-loading">Fetching breaking headlines...</div>';
    
    try {
        const response = await fetch(`${API_SERVER}/api/headlines`);
        const articles = await response.json();
        
        if (!articles || articles.length === 0) {
            newsList.innerHTML = '<div class="news-loading">No headlines available right now.</div>';
            return;
        }
        
        newsList.innerHTML = '';
        articles.forEach(article => {
            const item = document.createElement('div');
            item.classList.add('news-item');
            
            // Format date nicely if available
            let dateStr = 'Recent';
            if (article.published) {
                const d = new Date(article.published);
                if (!isNaN(d.getTime())) {
                    dateStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' - ' + d.toLocaleDateString();
                }
            }
            
            let bgStyle = '';
            if (article.image_url) {
                bgStyle = `style="background-image: url('${article.image_url}'); background-size: cover; background-position: center; color: transparent;"`;
            }

            const isSaved = bookmarks.some(b => b.link === article.link);
            
            item.innerHTML = `
                <div class="news-main" title="Click to read article">
                    <div class="news-title">${article.title}</div>
                    <div class="news-meta">${dateStr}</div>
                </div>
                <div style="display:flex; flex-direction:column; align-items:flex-end; padding-left:12px; gap:8px;">
                    <div class="news-link-btn" title="Read original article" ${bgStyle}></div>
                    <div style="display:flex; gap:6px; margin-top:4px;">
                        <button class="c-analyze-btn right-analyze-btn" style="width:28px;height:28px;background:var(--bg-panel);" title="Analyze with AI">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                        </button>
                        <button class="c-bookmark-btn ${isSaved ? 'saved' : ''}" style="width:28px;height:28px;background:var(--bg-panel);" title="Save article">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="${isSaved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>
                        </button>
                    </div>
                </div>
            `;
            
            // Clicking a headline opens article in new tab
            item.querySelector('.news-main').addEventListener('click', () => {
                window.open(article.link, '_blank');
            });
            
            item.querySelector('.news-link-btn').addEventListener('click', () => {
                window.open(article.link, '_blank');
            });
            
            // Analysis deep link
            item.querySelector('.right-analyze-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                openChatView();
                userInput.value = "Analyze this news: " + article.title;
                userInput.focus();
            });
            
            const btn = item.querySelector('.c-bookmark-btn');
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleBookmark(article, btn);
            });
            
            newsList.appendChild(item);
        });
        
    } catch (err) {
        newsList.innerHTML = '<div class="news-loading">Unable to fetch global news. Make sure backend is running.</div>';
    }
}

refreshNewsBtn.addEventListener('click', loadNews);

// Initial load
loadNews();

// Endless Scroll News Feature & Bookmarks
const allNewsContainer = document.getElementById('all-news-container');
const tabTrending = document.getElementById('tab-trending');
const tabBookmarks = document.getElementById('tab-bookmarks');
const navNewChatBtn = document.getElementById('nav-new-chat-btn');
const inputArea = document.querySelector('.input-area');

let bulkArticles = [];
let newsOffset = 0;
let currentNewsView = 'trending';

let bookmarks = JSON.parse(localStorage.getItem('quibly_bookmarks')) || [];

function toggleBookmark(article, btnElement) {
    const idx = bookmarks.findIndex(b => b.link === article.link);
    if (idx >= 0) {
        bookmarks.splice(idx, 1);
        btnElement.classList.remove('saved');
        btnElement.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>';
        
        if (currentNewsView === 'bookmarks') {
            btnElement.closest('.center-news-item').remove();
            if (bookmarks.length === 0) {
                allNewsContainer.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-secondary);">No bookmarked news yet.</div>';
            }
        }
    } else {
        bookmarks.push(article);
        btnElement.classList.add('saved');
        btnElement.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>';
    }
    localStorage.setItem('quibly_bookmarks', JSON.stringify(bookmarks));
}

function renderNewsContent(articlesArray) {
    articlesArray.forEach(article => {
        const item = document.createElement('div');
        item.classList.add('center-news-item');
        
        let dateStr = 'Recent';
        if (article.published) {
            const d = new Date(article.published);
            if (!isNaN(d.getTime())) {
                const diffHours = Math.round((Date.now() - d.getTime()) / 3600000);
                if (diffHours > 0 && diffHours < 24) {
                    dateStr = diffHours + ' hours ago';
                } else {
                    dateStr = d.toLocaleDateString();
                }
            }
        }
        
        const isSaved = bookmarks.some(b => b.link === article.link);
        let sourceName = 'News';
        try { sourceName = new URL(article.link).hostname.replace('www.', ''); } catch(e){}
        
        item.innerHTML = `
            <div class="c-news-main">
                <div class="c-news-source">
                    <img src="https://www.google.com/s2/favicons?domain=${sourceName}&sz=32" class="c-news-favicon" onerror="this.style.display='none'">
                    <span>${sourceName}</span>
                </div>
                <div class="c-news-title">${article.title}</div>
                <div class="c-news-time">${dateStr}</div>
            </div>
            <div class="c-news-right">
                ${article.image_url ? `<div class="c-news-thumb" style="background-image: url('${article.image_url}');"></div>` : '<div class="c-news-thumb" style="background: var(--accent-light);"></div>'}
                <div style="display:flex; gap:8px; align-items:center;">
                    <button class="c-analyze-btn" title="Analyze with AI">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                    </button>
                    <button class="c-bookmark-btn ${isSaved ? 'saved' : ''}" title="Save article">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="${isSaved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>
                    </button>
                </div>
            </div>
        `;
        
        const mainArea = item.querySelector('.c-news-main');
        mainArea.style.cursor = 'pointer';
        mainArea.addEventListener('click', () => {
            window.open(article.link, '_blank');
        });
        
        const rightArea = item.querySelector('.c-news-thumb');
        if(rightArea) {
            rightArea.style.cursor = 'pointer';
            rightArea.addEventListener('click', () => {
                window.open(article.link, '_blank');
            });
        }
        
        item.querySelector('.c-analyze-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            openChatView();
            userInput.value = "Analyze this news: " + article.title;
            userInput.focus();
        });
        
        const btn = item.querySelector('.c-bookmark-btn');
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleBookmark(article, btn);
        });
        
        allNewsContainer.appendChild(item);
    });
}

function renderMoreNews() {
    if (!bulkArticles || bulkArticles.length === 0 || currentNewsView !== 'trending') return;
    
    let chunk = [];
    for (let i = 0; i < 10; i++) {
        chunk.push(bulkArticles[newsOffset % bulkArticles.length]);
        newsOffset++;
    }
    renderNewsContent(chunk);
}

// --- NAVIGATIONAL STATE MANAGEMENT ---

function openAllNews() {
    chatBox.style.display = 'none';
    inputArea.style.display = 'none';
    allNewsContainer.style.display = 'block';
    
    if(tabTrending) tabTrending.classList.add('active');
    if(tabBookmarks) tabBookmarks.classList.remove('active');
    if(navNewChatBtn) navNewChatBtn.classList.remove('active');
    
    currentNewsView = 'trending';
    
    if (bulkArticles.length === 0) {
        allNewsContainer.innerHTML = '<div class="news-loading" style="margin:40px auto;">Loading mass global news...</div>';
        fetch(`${API_SERVER}/api/headlines`)
            .then(r => r.json())
            .then(data => {
                bulkArticles = data;
                allNewsContainer.innerHTML = '';
                newsOffset = 0;
                renderMoreNews();
            });
    } else {
        allNewsContainer.innerHTML = '';
        newsOffset = 0;
        renderMoreNews();
    }
}

function openBookmarks() {
    chatBox.style.display = 'none';
    inputArea.style.display = 'none';
    allNewsContainer.style.display = 'block';
    
    if(tabTrending) tabTrending.classList.remove('active');
    if(tabBookmarks) tabBookmarks.classList.add('active');
    if(navNewChatBtn) navNewChatBtn.classList.remove('active');
    
    currentNewsView = 'bookmarks';
    
    allNewsContainer.innerHTML = '';
    if (bookmarks.length === 0) {
        allNewsContainer.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-secondary);">No bookmarked news yet.</div>';
    } else {
        renderNewsContent(bookmarks);
    }
}

function openChatView() {
    allNewsContainer.style.display = 'none';
    chatBox.style.display = 'flex';
    inputArea.style.display = 'block';
    
    if(tabBookmarks) tabBookmarks.classList.remove('active');
    if(tabTrending) tabTrending.classList.remove('active');
    if(navNewChatBtn) navNewChatBtn.classList.add('active');
    
    chatBox.scrollTop = chatBox.scrollHeight;
}

if (navNewChatBtn) navNewChatBtn.addEventListener('click', startNewChat);
if (tabTrending) tabTrending.addEventListener('click', openAllNews);
if (tabBookmarks) tabBookmarks.addEventListener('click', openBookmarks);

allNewsContainer.addEventListener('scroll', () => {
    if (currentNewsView === 'trending' && allNewsContainer.scrollTop + allNewsContainer.clientHeight >= allNewsContainer.scrollHeight - 100) {
        renderMoreNews();
    }
});

// Enforce default startup state
window.addEventListener('DOMContentLoaded', () => {
    startNewChat();
});



