const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { YoutubeTranscript } = require('youtube-transcript');
const OpenAI = require('openai');

// Set up OpenAI API
// You'll need to set your API key as an environment variable
const openaiApiKey = "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";

class URLSummarizer {
  constructor() {
    this.client = new OpenAI({
      apiKey: openaiApiKey
    });
  }

  extractYoutubeId(url) {
    /**
     * Extract YouTube video ID from URL.
     */
    const youtubeRegex = /(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
    const match = url.match(youtubeRegex);
    return match ? match[1] : null;
  }

  async getYoutubeTranscript(url) {
    /**
     * Get transcript from YouTube video.
     */
    const videoId = this.extractYoutubeId(url);
    if (!videoId) {
      return { transcript: null, error: "Invalid YouTube URL" };
    }

    try {
      const transcriptItems = await YoutubeTranscript.fetchTranscript(videoId);
      const transcript = transcriptItems.map(item => item.text).join(" ");
      return { transcript, error: null };
    } catch (error) {
      if (error.message.includes("Transcript is disabled")) {
        return { transcript: null, error: "No transcript available for this video" };
      }
      return { transcript: null, error: `Error retrieving transcript: ${error.message}` };
    }
  }

  async getArticleContent(url) {
    /**
     * Extract text content from article URL.
     */
    try {
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      };
      
      const response = await axios.get(url, { headers, timeout: 10000 });
      const $ = cheerio.load(response.data);
      
      // Remove unwanted elements
      $('script, style, nav, footer, iframe, aside').remove();
      
      // Get article content (this is a simple approach - real implementations might need more tuning)
      let articleContent = $('article');
      if (articleContent.length === 0) {
        // If no article tag, try to get main content
        articleContent = $('main');
      }
      if (articleContent.length === 0) {
        // If no main tag, try getting the content from the body
        articleContent = $('body');
      }
      
      // Extract paragraphs
      const paragraphs = articleContent.find('p');
      let text = "";
      paragraphs.each((i, el) => {
        text += $(el).text().trim() + " ";
      });
      
      if (!text) {
        // If no paragraphs were found, get all text from the body
        text = $('body').text().replace(/\s+/g, ' ').trim();
      }
      
      return { text, error: null };
    } catch (error) {
      if (error.response) {
        return { text: null, error: `Error fetching the URL: ${error.message}` };
      }
      return { text: null, error: `Error processing article content: ${error.message}` };
    }
  }

  async summarizeWithChatGPT(content, sourceType) {
    /**
     * Generate a bullet-point summary using ChatGPT.
     */
    if (!content || content.length < 100) {
      return "The content is too short or could not be extracted properly.";
    }
    
    // Truncate content if it's too long (ChatGPT has token limits)
    const maxTokens = 16000;  // Assuming GPT-4 or similar model
    if (content.length > maxTokens * 4) {  // Rough character to token ratio
      content = content.substring(0, maxTokens * 4) + "...";
    }
    
    const prompt = `
    Please summarize the following ${sourceType} content in a concise bullet-point format. 
    Focus on the main ideas and key points. Return the summary as json with following schema:
    
    {
        "summary": "Summary of the content",
        "key_points": ["Key point 1", "Key point 2", "..."],
        "conclusion": "Conclusion or final takeaway"
    }
    
    The ${sourceType} content is:
    ${content}
    `;
    
    try {
      const response = await this.client.chat.completions.create({
        model: "gpt-4o-mini",  // You can change to a different model if needed
        messages: [
          { role: "system", content: "You are a helpful assistant that creates concise, accurate bullet-point summaries." },
          { role: "user", content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 1000
      });
      
      const summary = response.choices[0].message.content.trim();
      var summaryJson = summary.replace(/```json\n/, '').replace(/\n```/, '');
      return JSON.parse(summaryJson);
    } catch (error) {
      return `Error generating summary: ${error.message}`;
    }
  }

  async summarizeUrl(url) {
    /**
     * Main function to extract content and generate summary.
     */
    let content, error, sourceType;
    
    // Check if the URL is a YouTube video
    if (url.includes("youtube.com") || url.includes("youtu.be")) {
      const result = await this.getYoutubeTranscript(url);
      content = result.transcript;
      error = result.error;
      sourceType = "YouTube video";
    } else {
      const result = await this.getArticleContent(url);
      content = result.text;
      error = result.error;
      sourceType = "article";
    }
    
    if (error) {
      return error;
    }
    
    if (!content) {
      return "Could not extract content from the provided URL.";
    }
    
    const summary = await this.summarizeWithChatGPT(content, sourceType);
    return summary;
  }
}

// Example using Express.js
const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

app.post('/api/summarize', async (req, res) => {
    const { url } = req.body;
    try {
        const summarizer = new URLSummarizer();
        const summaryResult = await summarizer.summarizeUrl(url);

        res.json({ summary: summaryResult });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to generate summary.' });
    }
});

app.listen(3000, () => {
    console.log('Server is running on port 3000');
});