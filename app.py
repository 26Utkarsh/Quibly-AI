import os
import re
import time
import requests
import feedparser
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv
from google import genai
from google.genai import types

from flask_sqlalchemy import SQLAlchemy
from flask_bcrypt import Bcrypt
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user, current_user
from datetime import timedelta

load_dotenv()
frontend_dir = os.path.dirname(os.path.abspath(__file__)) 
app = Flask(__name__, static_folder=frontend_dir, static_url_path='')
CORS(app, supports_credentials=True)

app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'quibly-super-secret-key-123')
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///quibly.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['REMEMBER_COOKIE_DURATION'] = timedelta(days=7)

db = SQLAlchemy(app)
bcrypt = Bcrypt(app)
login_manager = LoginManager(app)

class User(db.Model, UserMixin):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(150), unique=True, nullable=False)
    password = db.Column(db.String(150), nullable=False)

with app.app_context():
    db.create_all()

@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, int(user_id))

@login_manager.unauthorized_handler
def unauthorized_callback():
    return jsonify({'error': 'Unauthorized. Please log in.'}), 401

@app.route('/')
def serve_index():
    return app.send_static_file('index.html')

@app.route('/<path:path>')
def serve_static(path):
    return app.send_static_file(path)

@app.route('/api/auth/register', methods=['POST'])
def register():
    data = request.json
    username = data.get('username')
    password = data.get('password')
    if not username or not password:
        return jsonify({'error': 'Gmail address and password required'}), 400
        
    if not username.endswith('@gmail.com'):
        return jsonify({'error': 'Please sign up using your Gmail address (@gmail.com)'}), 400
    
    if User.query.filter_by(username=username).first():
        return jsonify({'error': 'Username already exists'}), 400
        
    hashed_password = bcrypt.generate_password_hash(password).decode('utf-8')
    new_user = User(username=username, password=hashed_password)
    db.session.add(new_user)
    db.session.commit()
    
    login_user(new_user, remember=True)
    return jsonify({'message': 'Registration successful', 'username': username})

@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.json
    user = User.query.filter_by(username=data.get('username')).first()
    if user and bcrypt.check_password_hash(user.password, data.get('password')):
        login_user(user, remember=True)
        return jsonify({'message': 'Login successful', 'username': user.username})
    return jsonify({'error': 'Invalid username or password'}), 401

@app.route('/api/auth/logout', methods=['POST'])
@login_required
def logout():
    logout_user()
    return jsonify({'message': 'Logged out successfully'})

@app.route('/api/auth/status', methods=['GET'])
def auth_status():
    if current_user.is_authenticated:
        return jsonify({'authenticated': True, 'username': current_user.username})
    return jsonify({'authenticated': False})

GEMINI_API_KEY_PRIMARY = os.getenv('GEMINI_API_KEY_PRIMARY', '')
GEMINI_API_KEY_SECONDARY = os.getenv('GEMINI_API_KEY_SECONDARY', '')

# Build list of active clients (primary first, secondary fallback)
api_clients = []
for key in [GEMINI_API_KEY_PRIMARY, GEMINI_API_KEY_SECONDARY]:
    if key.strip() and key != 'your_gemini_api_key_here':
        api_clients.append(genai.Client(api_key=key))

client = api_clients[0] if api_clients else None

def get_fallback_analysis(headline):
    return f"""**Notice: Gemini API Key Not Configured**

Please configure your Gemini API Key in the `.env` file to enable AI contextual analysis. 

Current Headline: "{headline}"

*Without an API key, QUIBLY cannot infer missing context or provide detailed explanations.*"""


def get_fallback_chat(message):
    return "**Notice: Gemini API Key Not Configured**\n\nPlease add your API key to chat."


def call_with_retry(action_fn_builder):
    """Try each API client in order. On 429/503, rotate to the next key."""
    for idx, api_client in enumerate(api_clients):
        key_label = 'primary' if idx == 0 else 'secondary'
        max_retries = 3
        for attempt in range(max_retries):
            try:
                response = action_fn_builder(api_client)()
                return response.text
            except Exception as e:
                err_str = str(e)
                if '429' in err_str or 'RESOURCE_EXHAUSTED' in err_str:
                    # Quota hit — stop retrying this key and try next
                    print(f"[Quibly] {key_label} key quota exhausted, rotating...")
                    break
                elif '503' in err_str or 'UNAVAILABLE' in err_str:
                    if attempt < max_retries - 1:
                        time.sleep(1.5 ** (attempt + 1))
                        continue
                    break
                else:
                    return f"**Error:** {str(e)}"

    return "**Service Unavailable**\n\nAll API keys have hit their quota limit. Please wait a few minutes and try again, or add a new API key."


@app.route('/api/analyze', methods=['POST'])
def analyze_headline():
    data = request.json
    headline = data.get('headline', '').strip()
    
    if not headline:
        return jsonify({'error': 'Headline is required'}), 400
        
    if not api_clients:
        return jsonify({'response': get_fallback_analysis(headline)})
        
    prompt = f"""You are QUIBLY — a sharp, witty AI news analyst who sounds like a brilliant friend who reads every newspaper and also watches too much stand-up comedy.

    The user gave you this headline: "{headline}"

    Your job is to break it down with BOTH intelligence AND humor. Structure your response EXACTLY like this:

    ## 🧠 What's Actually Going On
    Give a 2-3 sentence clear explanation of the story, filling in any missing context.

    ## 🔍 The Key Players
    Bullet-point list of who's involved and their role. Keep it crisp.

    ## 📍 Why This Matters
    Explain the real-world significance in 2-3 punchy sentences.

    ## 😄 Quibly's Take
    This is your humor section. One or two sentences with a clever, slightly sarcastic observation about the situation. Think late-night TV host energy, not mean-spirited. Use a blockquote for this section.

    ## ⚡ TLDR
    One single bold sentence that wraps it all up.

    Rules: Use markdown formatting properly. Keep total response under 350 words. Be genuinely funny in the humor section — no forced laughs."""

    try:
        def _builder(c):
            def _action():
                return c.models.generate_content(
                    model='gemini-2.5-flash-lite',
                    contents=prompt,
                )
            return _action
        response_text = call_with_retry(_builder)
        return jsonify({'response': response_text})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/chat', methods=['POST'])
def chat():
    data = request.json
    message = data.get('message', '').strip()
    history = data.get('history', [])
    
    if not message:
        return jsonify({'error': 'Message is required'}), 400
        
    if not api_clients:
        return jsonify({'response': get_fallback_chat(message)})
        
    try:
        # Convert history format
        formatted_history = []
        for msg in history:
            role = 'user' if msg['role'] == 'user' else 'model'
            formatted_history.append(
                types.Content(role=role, parts=[types.Part.from_text(text=msg['content'])])
            )
        
        def _builder(c):
            chat_session = c.chats.create(
                model='gemini-2.5-flash-lite',
                config=types.GenerateContentConfig(
                    system_instruction="You are QUIBLY, an AI-driven news analysis platform with a slightly witty and humorous personality. You provide accurate, context-rich answers about news topics (especially geopolitics, economy, wars, and entertainment) while keeping the tone engaging and lightly humorous."
                ),
                history=formatted_history
            )
            def _action():
                return chat_session.send_message(message)
            return _action
            
        response_text = call_with_retry(_builder)
        return jsonify({'response': response_text})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/headlines', methods=['GET'])
def fetch_headlines():
    import random
    
    # Specific limits for each source to guarantee diversity (total 20 articles)
    feed_configs = [
        {'url': 'https://timesofindia.indiatimes.com/rssfeedstopstories.cms', 'limit': 6}, # India (approx 30%)
        {'url': 'http://feeds.bbci.co.uk/news/world/europe/rss.xml', 'limit': 4}, # Europe
        {'url': 'http://feeds.bbci.co.uk/news/business/rss.xml', 'limit': 4}, # Economy
        {'url': 'http://feeds.bbci.co.uk/news/world/rss.xml', 'limit': 3}, # Global
        {'url': 'http://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml', 'limit': 2}, # USA
        {'url': 'http://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml', 'limit': 1} # Entertainment
    ]
    
    articles = []
    seen_titles = set()
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
    
    for feed in feed_configs:
        try:
            resp = requests.get(feed['url'], headers=headers, timeout=5)
            if resp.status_code == 200:
                parsed = feedparser.parse(resp.content)
                added = 0
                for entry in parsed.entries:
                    title = entry.get('title', '')
                    if title and title not in seen_titles:
                        seen_titles.add(title)
                        
                        image_url = ''
                        if 'media_content' in entry and len(entry.media_content) > 0:
                            image_url = entry.media_content[0].get('url', '')
                        elif 'media_thumbnail' in entry and len(entry.media_thumbnail) > 0:
                            image_url = entry.media_thumbnail[0].get('url', '')
                        elif hasattr(entry, 'links'):
                            for link in entry.links:
                                if hasattr(link, 'type') and link.type.startswith('image/'):
                                    image_url = link.href
                                    break
                                    
                        articles.append({
                            'title': title,
                            'link': entry.get('link', ''),
                            'published': entry.get('published', ''),
                            'image_url': image_url
                        })
                        added += 1
                        if added >= feed['limit']:
                            break
        except Exception:
            continue
            
    # Shuffle so the 25% Indian content is naturally interspersed among the others
    random.shuffle(articles)
    return jsonify(articles)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5005, debug=True)
