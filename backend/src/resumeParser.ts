import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');

export interface ParsedResumeInfo {
  fullName: string;
  email: string;
  phone: string;
  title: string;
  bio: string;
}

export interface ResumeParseResult {
  text: string;
  parsed: ParsedResumeInfo;
}

/**
 * Clean up a string to remove duplicate spaces and control characters.
 */
function cleanString(str: string): string {
  return str.replace(/\s+/g, ' ').trim();
}

/**
 * Extracts raw text from a base64 encoded PDF document.
 */
export async function extractTextFromPdf(base64Data: string): Promise<string> {
  // Strip off data url prefix if present (e.g., "data:application/pdf;base64,")
  const base64Clean = base64Data.replace(/^data:application\/pdf;base64,/, '');
  const buffer = Buffer.from(base64Clean, 'base64');
  
  const parsedData = await pdf(buffer);
  return parsedData.text || '';
}

/**
 * Parse contact information, name, professional title, and bio summary from resume text.
 */
export function parseResumeText(text: string): ParsedResumeInfo {
  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  // 1. Extract Email
  let email = '';
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const emailMatches = text.match(emailRegex);
  if (emailMatches && emailMatches.length > 0) {
    email = emailMatches[0].trim();
  }

  // 2. Extract Phone
  let phone = '';
  // Matches typical phone patterns: +1-123-456-7890, +66 81 234 5678, (123) 456-7890, etc.
  const phoneRegex = /(?:\+?\d{1,4}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g;
  const phoneMatches = text.match(phoneRegex);
  if (phoneMatches) {
    // Filter out common false positives like dates (2020-2022) or zip codes (10001)
    const validPhone = phoneMatches.find(p => {
      const numbersOnly = p.replace(/\D/g, '');
      return numbersOnly.length >= 8 && numbersOnly.length <= 15;
    });
    if (validPhone) {
      phone = validPhone.trim();
    }
  }

  // 3. Extract Full Name
  // Typically the full name is one of the first lines of the resume.
  // We'll inspect the first 10 lines and pick the first line that is likely to be a name.
  let fullName = '';
  const nameExcludes = [
    'resume', 'cv', 'curriculum', 'vitae', 'portfolio', 'contact', 'profile', 'summary',
    'phone', 'email', 'address', 'page', 'github', 'linkedin', 'http', 'www', 'education'
  ];

  for (let i = 0; i < Math.min(lines.length, 12); i++) {
    const line = lines[i];
    const lowerLine = line.toLowerCase();

    // Skip if empty or too long/short
    if (line.length < 3 || line.length > 40) continue;
    // Skip if it contains email, phone, or website URLs
    if (email && lowerLine.includes(email.toLowerCase())) continue;
    if (phone && lowerLine.includes(phone.replace(/\D/g, ''))) continue;
    if (lowerLine.includes('http') || lowerLine.includes('.com') || lowerLine.includes('/') || lowerLine.includes('@')) continue;
    // Skip if it matches any exclude keyword
    if (nameExcludes.some(ex => lowerLine.includes(ex))) continue;
    // Skip if it looks like a list or numbers
    if (/^\d/.test(line) || line.includes(':') || line.includes('|') || line.includes('•')) continue;

    // Check if the line has 2 to 4 words in Title Case (or Uppercase)
    const words = line.split(/\s+/);
    if (words.length >= 2 && words.length <= 4) {
      fullName = line;
      break;
    }
  }

  // Fallback name if nothing matched
  if (!fullName) {
    fullName = 'Extracted Resume Profile';
  }

  // 4. Extract Professional Title
  // Usually, the title is right under the name or within the first 15 lines.
  // We look for common professional keywords (e.g. Developer, Engineer, Architect, Designer, Specialist, Manager).
  let title = '';
  const titleKeywords = [
    'developer', 'engineer', 'architect', 'designer', 'analyst', 'manager', 'consultant',
    'specialist', 'strategist', 'writer', 'lead', 'director', 'officer', 'head', 'scientist',
    'practitioner', 'administrator', 'coordinator'
  ];

  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const line = lines[i];
    const lowerLine = line.toLowerCase();

    // Skip if this line is the name we extracted
    if (line === fullName) continue;
    if (line.length < 5 || line.length > 50) continue;
    if (lowerLine.includes('http') || lowerLine.includes('@')) continue;

    // Check if line contains any professional keywords
    const matchesKeyword = titleKeywords.some(keyword => {
      const regex = new RegExp(`\\b${keyword}\\b`, 'i');
      return regex.test(lowerLine);
    });

    if (matchesKeyword && !line.includes(':') && !line.includes('|')) {
      title = line;
      break;
    }
  }

  // If no professional title found, check a few lines near the name
  if (!title && fullName) {
    const nameIndex = lines.indexOf(fullName);
    if (nameIndex !== -1 && nameIndex + 1 < lines.length) {
      const nextLine = lines[nameIndex + 1];
      if (nextLine.length > 4 && nextLine.length < 40 && !nextLine.includes('@') && !nextLine.includes('http')) {
        title = nextLine;
      }
    }
  }

  // Fallback title
  if (!title) {
    title = 'Professional Specialist';
  }

  // 5. Extract Bio / Summary Section
  // We'll search for common sections like "Summary", "Profile", "Objective", "About Me".
  let bio = '';
  const summaryHeaders = ['summary', 'profile', 'objective', 'about me', 'professional summary', 'executive summary'];
  const nextSectionHeaders = ['experience', 'education', 'employment', 'skills', 'projects', 'languages', 'certifications', 'history', 'interests'];

  let summaryStartIndex = -1;

  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const line = lines[i];
    const lowerLine = line.toLowerCase().replace(/[^a-z\s]/g, '').trim();

    if (summaryHeaders.includes(lowerLine)) {
      summaryStartIndex = i;
      break;
    }
  }

  if (summaryStartIndex !== -1) {
    // Collect subsequent lines until we hit another section header or too many lines (max 8 lines or 1000 chars)
    const bioLines: string[] = [];
    for (let j = summaryStartIndex + 1; j < Math.min(lines.length, summaryStartIndex + 8); j++) {
      const line = lines[j];
      const lowerLine = line.toLowerCase().replace(/[^a-z\s]/g, '').trim();

      if (nextSectionHeaders.some(header => lowerLine === header || lowerLine.startsWith(header + ' '))) {
        break;
      }
      bioLines.push(line);
    }
    bio = bioLines.join(' ');
  }

  // Fallback bio: if we couldn't find a summary section, let's take the first paragraph
  // of reasonable text that is not the name, title, or contact details.
  if (!bio || bio.length < 20) {
    const bioParagraphs: string[] = [];
    for (let i = 0; i < Math.min(lines.length, 15); i++) {
      const line = lines[i];
      if (line === fullName || line === title || (email && line.includes(email)) || (phone && line.includes(phone))) {
        continue;
      }
      // Skip very short lines or headers
      if (line.length < 30 || line.includes(':') || line.includes('|') || line.startsWith('•')) {
        continue;
      }
      bioParagraphs.push(line);
      if (bioParagraphs.length >= 2) break; // Grab up to 2 sentences/lines
    }
    bio = bioParagraphs.join(' ');
  }

  // Clean strings
  return {
    fullName: cleanString(fullName),
    email: cleanString(email),
    phone: cleanString(phone),
    title: cleanString(title),
    bio: cleanString(bio).substring(0, 1000) // Truncate if necessary
  };
}
