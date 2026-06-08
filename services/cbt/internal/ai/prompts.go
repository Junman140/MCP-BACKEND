package ai

import (
	"fmt"
	"strings"
)

func BuildQuestionGenPrompt(params QuestionGenParams) string {
	types := strings.Join(params.Types, ", ")
	if types == "" {
		types = "mcq"
	}

	var sb strings.Builder
	sb.WriteString("You are an expert examination question generator for a Nigerian university. ")
	sb.WriteString("Generate high-quality, curriculum-aligned questions. ")
	sb.WriteString("Output must be valid JSON with exactly this structure: ")
	sb.WriteString(`{"questions":[{"type":"mcq","content":"question text here","options":[{"opt_id":"A","text":"option A"},{"opt_id":"B","text":"option B"}],"correct_opt_id":"A","points":5,"difficulty":"medium","tags":["tag1"],"topic":"topic"}]}`)
	sb.WriteString("\n\nRULES:\n")
	sb.WriteString("- For MCQ: include exactly 4 options labeled A,B,C,D. Set correct_opt_id to the correct one.\n")
	sb.WriteString("- For essay: set type to \"essay\", include a word_limit, omit options and correct_opt_id.\n")
	sb.WriteString("- For file_upload: set type to \"file_upload\", omit options and correct_opt_id.\n")
	sb.WriteString("- Content may use Markdown for formatting and LaTeX between $$ for math.\n")
	sb.WriteString("- Points: 1-2 for easy, 2-3 for medium, 3-5 for hard.\n")
	sb.WriteString("- Each question must have 2-4 relevant tags.\n")
	sb.WriteString("- Output ONLY the JSON object, no preamble or explanation.\n")

	if params.CourseName != "" {
		sb.WriteString(fmt.Sprintf("\nYou are generating questions for the course: %s.\n", params.CourseName))
	}

	sb.WriteString(fmt.Sprintf("\nTopic: %s\n", params.Topic))
	sb.WriteString(fmt.Sprintf("Difficulty: %s\n", params.Difficulty))
	sb.WriteString(fmt.Sprintf("Question types: %s\n", types))
	sb.WriteString(fmt.Sprintf("Number of questions: %d\n", params.Count))

	if params.ContextText != "" {
		sb.WriteString(fmt.Sprintf("\nUse the following curriculum/source material as context:\n---\n%s\n---\n", params.ContextText))
	}

	sb.WriteString("\nGenerate the questions now. Remember: JSON only, no extra text.")

	return sb.String()
}

func BuildFromTextPrompt(params GenerateFromTextParams) string {
	types := strings.Join(params.Types, ", ")
	if types == "" {
		types = "mcq"
	}

	var sb strings.Builder
	sb.WriteString("You are an expert examination question generator. ")
	sb.WriteString("Based on the provided text, generate assessment questions. ")
	sb.WriteString("Output must be valid JSON with exactly this structure: ")
	sb.WriteString(`{"questions":[{"type":"mcq","content":"question text here","options":[{"opt_id":"A","text":"option A"},{"opt_id":"B","text":"option B"}],"correct_opt_id":"A","points":5,"difficulty":"medium","tags":["tag1"],"topic":"topic"}]}`)
	sb.WriteString("\n\nRULES:\n")
	sb.WriteString("- For MCQ: include exactly 4 options labeled A,B,C,D.\n")
	sb.WriteString("- For essay: set type to \"essay\", include a word_limit.\n")
	sb.WriteString("- Content may use Markdown and LaTeX between $$.\n")
	sb.WriteString("- Points: 1-2 for easy, 2-3 for medium, 3-5 for hard.\n")
	sb.WriteString("- Output ONLY the JSON object.\n")

	sb.WriteString(fmt.Sprintf("\nDifficulty: %s\n", params.Difficulty))
	sb.WriteString(fmt.Sprintf("Question types: %s\n", types))
	sb.WriteString(fmt.Sprintf("Number of questions: %d\n", params.Count))

	sb.WriteString(fmt.Sprintf("\nSource text:\n---\n%s\n---\n", params.Text))
	sb.WriteString("\nGenerate the questions now. JSON only.")

	return sb.String()
}

func BuildGradeEssayPrompt(params GradeEssayParams) string {
	var sb strings.Builder
	sb.WriteString("You are an expert university examiner grading a student's essay/short-answer response. ")
	sb.WriteString("Evaluate the answer fairly and thoroughly. ")
	sb.WriteString("Output must be valid JSON with exactly this structure: ")
	sb.WriteString(`{"score":0,"max_points":10,"feedback":"detailed feedback here","confidence":0.85,"key_points_covered":["point1","point2"],"missed_points":["point3"]}`)
	sb.WriteString("\n\nRULES:\n")
	sb.WriteString("- score: award 0 to max_points based on accuracy, completeness, clarity, and relevance.\n")
	sb.WriteString("- feedback: write 2-4 sentences of constructive, specific feedback. Mention strengths and areas to improve.\n")
	sb.WriteString("- confidence: a float 0.0-1.0 indicating how certain you are of this grade. 0.9+ for clear-cut answers, 0.5-0.7 for ambiguous ones.\n")
	sb.WriteString("- key_points_covered: list the main concepts the student addressed correctly.\n")
	sb.WriteString("- missed_points: list concepts the student should have mentioned but didn't.\n")
	sb.WriteString("- Be generous but accurate. Don't penalize minor spelling/grammar errors unless they affect meaning.\n")
	sb.WriteString("- Output ONLY the JSON object, no preamble or explanation.\n")

	sb.WriteString(fmt.Sprintf("\nQuestion:\n%s\n", params.QuestionText))

	if params.ModelAnswer != "" {
		sb.WriteString(fmt.Sprintf("\nModel Answer / Expected Response:\n%s\n", params.ModelAnswer))
	}
	if params.Rubric != "" {
		sb.WriteString(fmt.Sprintf("\nMarking Rubric:\n%s\n", params.Rubric))
	}

	sb.WriteString(fmt.Sprintf("\nMaximum Points: %d\n", params.MaxPoints))
	if params.WordLimit > 0 {
		sb.WriteString(fmt.Sprintf("Word Limit: %d\n", params.WordLimit))
	}

	sb.WriteString(fmt.Sprintf("\nStudent's Answer:\n%s\n", params.StudentAnswer))
	sb.WriteString("\nEvaluate this answer now. JSON only.")

	return sb.String()
}
