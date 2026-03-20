
import { GoogleGenAI, Type } from "@google/genai";
import { Question } from "../types";

export const generateQuizFromText = async (text: string, title: string): Promise<Question[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
  
  const prompt = `
    VAI TRÒ: Bạn là một chuyên gia soạn đề trắc nghiệm AI với độ chính xác tuyệt đối.
    NGUỒN DỮ LIỆU: "${text.substring(0, 15000)}"
    
    YÊU CẦU NGHIÊM NGẶT:
    1. ƯU TIÊN TRÍCH XUẤT: Nếu trong văn bản đã có sẵn các câu hỏi trắc nghiệm (có dạng Câu 1, Câu 2... hoặc có các lựa chọn A, B, C, D), bạn PHẢI giữ nguyên nội dung câu hỏi và các lựa chọn đó. Không được tóm tắt làm mất ý nghĩa gốc.
    2. ĐỌC ĐÁP ÁN CÓ SẴN (RẤT QUAN TRỌNG): Nếu trong file có cung cấp sẵn bảng đáp án, hoặc đáp án được đánh dấu (khoanh tròn, in đậm, gạch chân, hoặc ghi ở cuối file), bạn BẮT BUỘC phải tìm, đọc và sử dụng chính xác các đáp án đó cho từng câu hỏi tương ứng. Tuyệt đối không tự suy luận đáp án khác nếu đã có đáp án trong file.
    3. TỰ SOẠN THẢO: Chỉ khi văn bản là nội dung kiến thức thuần túy (không có câu hỏi), bạn mới tự soạn các câu hỏi trắc nghiệm bao quát các ý chính quan trọng nhất.
    4. ĐỊNH DẠNG: Mỗi câu hỏi PHẢI có đúng 4 lựa chọn. Nếu đề gốc chỉ có 2-3 lựa chọn, hãy tự thêm các lựa chọn gây nhiễu hợp lý để đủ 4.
    5. CHÍNH XÁC: 
       - Đảm bảo đáp án đúng (correctAnswer) là đáp án CHÍNH XÁC NHẤT theo logic và kiến thức (nếu file không có sẵn đáp án).
    6. GIẢI THÍCH: Viết giải thích ngắn gọn, súc tích cho mỗi câu, chỉ ra tại sao đáp án đó đúng.

    KẾT QUẢ TRẢ VỀ: Một JSON array các object câu hỏi.
    CHỦ ĐỀ: ${title}
  `;

  // Sử dụng gemini-3-flash-preview để có khả năng reasoning tốt hơn trong việc phân biệt câu hỏi có sẵn
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: [{ parts: [{ text: prompt }] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            question: { type: Type.STRING },
            options: { 
              type: Type.ARRAY, 
              items: { type: Type.STRING },
              description: "Mảng chứa đúng 4 lựa chọn"
            },
            correctAnswer: { type: Type.INTEGER, description: "Index đáp án đúng (0-3)" },
            explanation: { type: Type.STRING, description: "Giải thích tại sao đúng" }
          },
          required: ["question", "options", "correctAnswer", "explanation"]
        }
      },
      thinkingConfig: { thinkingBudget: 1024 }
    }
  });

  try {
    const textOutput = response.text;
    if (!textOutput) throw new Error("AI không trả về nội dung.");
    
    const questions: Question[] = JSON.parse(textOutput).map((q: any, index: number) => ({
      ...q,
      id: `q-${Date.now()}-${index}`
    }));
    
    if (questions.length === 0) {
      throw new Error("Không tìm thấy hoặc không tạo được câu hỏi nào từ nội dung này.");
    }
    
    return questions;
  } catch (error) {
    console.error("Failed to parse AI response:", error);
    throw new Error("Lỗi xử lý dữ liệu từ AI. Hãy thử lại với đoạn văn bản ngắn hơn hoặc định dạng file rõ ràng hơn.");
  }
};
