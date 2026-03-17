#!/usr/bin/env python3
"""
Web Content Sanitizer - Strips malicious content before processing

This sanitizes HTML content fetched from the web to prevent
prompt injection attacks via web content.

Usage:
    python3 sanitizer.py "<html content>"
    cat file.html | python3 sanitizer.py
"""

import re
import sys
import html.parser

class HTMLSanitizer(html.parser.HTMLParser):
    """Strip malicious elements from HTML"""
    
    ALLOWED_TAGS = {
        'p', 'br', 'b', 'i', 'u', 'strong', 'em',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'ul', 'ol', 'li', 'a', 'img', 'table', 'tr', 'td', 'th',
        'thead', 'tbody', 'blockquote', 'pre', 'code', 'span', 'div'
    }
    
    # Attributes to strip (can contain javascript:)
    STRIP_ATTRS = ['onclick', 'onerror', 'onload', 'onmouseover', 'onfocus', 'onblur']
    
    def __init__(self):
        super().__init__()
        self.output = []
        self.skip_depth = 0
        
    def handle_starttag(self, tag, attrs):
        if self.skip_depth > 0:
            return
            
        tag = tag.lower()
        if tag not in self.ALLOWED_TAGS:
            return
            
        # Strip dangerous attributes
        safe_attrs = []
        for k, v in attrs:
            k = k.lower()
            if k in self.STRIP_ATTRS:
                continue
            # Strip javascript: URLs
            if v and v.lower().startswith('javascript:'):
                continue
            safe_attrs.append((k, v))
        
        attr_str = ''
        if safe_attrs:
            attr_str = ' ' + ' '.join(f'{k}="{v}"' for k, v in safe_attrs if v)
        
        self.output.append(f'<{tag}{attr_str}>')
        
    def handle_endtag(self, tag):
        if self.skip_depth > 0:
            if tag.lower() in ['script', 'style', 'iframe']:
                self.skip_depth -= 1
            return
            
        tag = tag.lower()
        if tag not in self.ALLOWED_TAGS:
            return
        self.output.append(f'</{tag}>')
        
    def handle_data(self, data):
        if self.skip_depth == 0:
            self.output.append(data)
            
    def handle_startendtag(self, tag, attrs):
        if self.skip_depth > 0:
            return
        tag = tag.lower()
        if tag not in self.ALLOWED_TAGS:
            return
        # Strip dangerous attributes
        safe_attrs = []
        for k, v in attrs:
            k = k.lower()
            if k in self.STRIP_ATTRS:
                continue
            if v and v.lower().startswith('javascript:'):
                continue
            safe_attrs.append((k, v))
        
        attr_str = ''
        if safe_attrs:
            attr_str = ' ' + ' '.join(f'{k}="{v}"' for k, v in safe_attrs if v)
            
        self.output.append(f'<{tag}{attr_str} />')
        
def sanitize_html(html_content: str) -> str:
    """Main sanitization function"""
    # Step 1: Remove script tags entirely
    html_content = re.sub(r'<script[^>]*>.*?</script>', '', html_content, flags=re.DOTALL | re.IGNORECASE)
    html_content = re.sub(r'<script[^>]*/?>', '', html_content, flags=re.IGNORECASE)
    
    # Step 2: Remove style tags
    html_content = re.sub(r'<style[^>]*>.*?</style>', '', html_content, flags=re.DOTALL | re.IGNORECASE)
    
    # Step 3: Remove iframe tags
    html_content = re.sub(r'<iframe[^>]*>.*?</iframe>', '', html_content, flags=re.DOTALL | re.IGNORECASE)
    html_content = re.sub(r'<iframe[^>]*/?>', '', html_content, flags=re.IGNORECASE)
    
    # Step 4: Remove object/embed tags
    html_content = re.sub(r'<object[^>]*>.*?</object>', '', html_content, flags=re.DOTALL | re.IGNORECASE)
    html_content = re.sub(r'<embed[^>]*/?>', '', html_content, flags=re.IGNORECASE)
    
    # Step 5: Remove form tags (prevent post-back attacks)
    html_content = re.sub(r'<form[^>]*>.*?</form>', '', html_content, flags=re.DOTALL | re.IGNORECASE)
    
    # Step 6: Remove event handlers from remaining tags
    html_content = re.sub(r'\s+on\w+\s*=\s*["\'].*?["\']', '', html_content, flags=re.IGNORECASE)
    html_content = re.sub(r'\s+on\w+\s*=\s*[^\s>]+', '', html_content, flags=re.IGNORECASE)
    
    # Step 7: Remove javascript: URLs
    html_content = re.sub(r'href\s*=\s*["\']?javascript:[^"\'>\s]+', 'href="#"', html_content, flags=re.IGNORECASE)
    html_content = re.sub(r'src\s*=\s*["\']?javascript:[^"\'>\s]+', 'src="#"', html_content, flags=re.IGNORECASE)
    
    # Step 8: Use HTMLParser to further clean
    parser = HTMLSanitizer()
    try:
        parser.feed(html_content)
        html_content = ''.join(parser.output)
    except:
        pass
    
    return html_content

def html_to_text(html: str) -> str:
    """Convert sanitized HTML to plain text"""
    import re
    
    # Remove all tags
    text = re.sub(r'<[^>]+>', '', html)
    
    # Decode common HTML entities
    text = text.replace('&nbsp;', ' ')
    text = text.replace('&amp;', '&')
    text = text.replace('&lt;', '<')
    text = text.replace('&gt;', '>')
    text = text.replace('&quot;', '"')
    text = text.replace('&#39;', "'")
    text = text.replace('&apos;', "'")
    
    # Clean up whitespace
    text = re.sub(r'\n\s*\n', '\n\n', text)
    text = text.strip()
    
    return text

if __name__ == "__main__":
    if len(sys.argv) > 1:
        content = sys.argv[1]
    else:
        content = sys.stdin.read()
    
    sanitized = sanitize_html(content)
    text = html_to_text(sanitized)
    print(text)
