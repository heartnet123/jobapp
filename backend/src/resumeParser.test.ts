import { describe, it, expect } from '@rstest/core';
import { parseResumeText } from './resumeParser';

describe('Resume Parsing Heuristics', () => {
  it('correctly parses standard resume formats', () => {
    const resumeText = `
      Jane Amanda Doe
      Senior Software Engineer
      
      CONTACT INFORMATION
      Email: jane.doe@example.com
      Phone: +1 (555) 019-2834
      Website: github.com/janedoe
      
      PROFESSIONAL SUMMARY
      Dynamic and detail-oriented Senior Software Engineer with over 8 years of experience building scalable web applications. Expert in TypeScript, Vue, and backend design. Proven track record of leading development teams to deliver projects on time.
      
      WORK EXPERIENCE
      Tech Giants Corp - Lead Engineer (2022 - Present)
      - Led a team of 5 developers
      - Architected new high-performance microservices
    `;

    const result = parseResumeText(resumeText);

    expect(result.fullName).toBe('Jane Amanda Doe');
    expect(result.title).toBe('Senior Software Engineer');
    expect(result.email).toBe('jane.doe@example.com');
    expect(result.phone).toBe('+1 (555) 019-2834');
    expect(result.bio).toContain('Dynamic and detail-oriented Senior Software Engineer');
  });

  it('handles resumes with summary sections lacking headers using fallback heuristics', () => {
    const resumeText = `
      Bob Smith
      Frontend Developer
      bob.smith@gmail.com | 123-456-7890 | linkedin.com/in/bobsmith
      
      A passionate Frontend Developer specializing in React and Vue. I enjoy creating beautiful, accessible, and performant user interfaces for clients globally.
      
      Skills:
      HTML, CSS, JavaScript, React, Vue, Git
    `;

    const result = parseResumeText(resumeText);

    expect(result.fullName).toBe('Bob Smith');
    expect(result.title).toBe('Frontend Developer');
    expect(result.email).toBe('bob.smith@gmail.com');
    expect(result.phone).toBe('123-456-7890');
    expect(result.bio).toContain('A passionate Frontend Developer specializing in React and Vue.');
  });
});
