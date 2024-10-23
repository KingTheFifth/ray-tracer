# set this variable to the director in which you saved the common files
commondir = ./common/

all : ray_tracer

ray_tracer : main.cpp $(commondir)GL_utilities.c $(commondir)VectorUtils4.h $(commondir)LittleOBJLoader.h $(commondir)LoadTGA.c $(commondir)Linux/MicroGlut.c
	g++ -Wall -o main.out -I$(commondir) -I./common/Linux -DGL_GLEXT_PROTOTYPES main.cpp $(commondir)GL_utilities.c $(commondir)LoadTGA.c $(commondir)Linux/MicroGlut.c -lXt -lX11 -lGL -lm

clean :
	rm main

